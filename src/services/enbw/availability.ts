import type { Charger } from '../../core/types'
import { stationIdOf } from './wire'

/**
 * The live half of a station: what the shipped list cannot know.
 *
 * That used to mean occupancy and nothing else. It now also means the things
 * only `/chargestations/{id}` returns — the individual charge points and their
 * plugs — because the Worker was already making exactly this request per
 * station and throwing that part of the answer away.
 * Widening what it keeps costs no extra upstream request and no extra latency.
 *
 * Station *identity* is still not in here. Location, address, power and point
 * count come from the shipped list, so a failed lookup costs the extras and
 * never the row itself. The location line is the newest member of that rule:
 * `additionalInfo` does come back on this request, but it is the raw
 * multi-line blob — site name, then access and parking prose — and the list
 * already carries the first line of it. Taking the live copy would rewrite a
 * row's own heading the moment its panel was opened.
 *
 * One request per station: EnBW has no bulk endpoint. This used to fetch
 * bounding boxes, because a box could in principle cover several nearby
 * stations for one request. Measured on a real route it covers exactly one —
 * corridor candidates are kilometres apart — and a box is answered through
 * EnBW's clustering grid, which collapses any cell holding two stations into a
 * placeholder with no id and no occupancy. Asking for one station by id has the
 * same request count, the same latency, and no grouping at all.
 */

/** The fields a live lookup can add to a `Charger`, named to spread straight on. */
export type LiveStation = Pick<
  Charger,
  'unknownPoints' | 'operatorCode' | 'alwaysOpen' | 'chargePoints'
> & {
  /**
   * Points free right now. Null is impossible here — an absent station is
   * absent from the map — but `Charger.availablePoints` is nullable because the
   * shipped list cannot know it.
   */
  availablePoints: number
  /** Omitted when upstream does not report it, so the list's count survives. */
  totalPoints?: number
}

/** Wire shape of the Worker's reply: one record per station id. */
export interface LiveStationRecord extends LiveStation {
  stationId: number
}

export interface FetchOptions {
  signal?: AbortSignal
  /**
   * Called once per station as its own lookup settles, with `null` for a
   * station the upstream did not answer for — a re-issued id, or a request that
   * failed. It exists so a caller can retire that row's spinner the moment its
   * answer lands rather than when the slowest of 45 does; the resolved value is
   * still the authoritative result.
   *
   * A fetcher that has no per-station structure may simply not call it. The
   * final result is unaffected either way.
   */
  onRecord?: (stationId: number, record: LiveStationRecord | null) => void
}

export type LiveStationFetcher = (
  stationIds: number[],
  options?: FetchOptions,
) => Promise<LiveStationRecord[]>

/**
 * One station, through the Worker, which holds the key and the Origin.
 *
 * Null rather than throwing on 404: EnBW re-issues station ids in bulk, so a
 * shipped list a few days old always has some, and an id it has dropped is a
 * fact about the list rather than a failure of the lookup.
 */
export async function fetchStationRecord(
  stationId: number,
  signal?: AbortSignal,
): Promise<LiveStationRecord | null> {
  const res = await fetch(`/api/chargers/${stationId}`, { signal })
  if (res.status === 404) return null
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Availability lookup failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as LiveStationRecord
}

/**
 * Default fetcher: one request per station, all of them in flight at once.
 *
 * No pool. Over HTTP/2 these are streams on a single connection and the
 * browser schedules them; adding a semaphore here would only re-impose, worse,
 * the six-at-a-time the Worker used to do. Note that a dev server proxying on
 * HTTP/1.1 *will* cap this at six per origin, so latency measured through
 * `vite dev` is not what production does.
 *
 * Failures are per station, which is the whole point of fanning out here: one
 * station having a bad minute costs its own badge and nothing else. The
 * exception is a total wipeout — no record at all, at least one error — which
 * is not bad luck but the upstream being down or the key having been rotated,
 * and is rethrown so it reaches a log with its real message instead of
 * vanishing into an empty result.
 */
export const fetchViaWorker: LiveStationFetcher = async (stationIds, options = {}) => {
  const settled = await Promise.allSettled(
    stationIds.map((id) =>
      fetchStationRecord(id, options.signal).then(
        (record) => {
          options.onRecord?.(id, record)
          return record
        },
        (err) => {
          // Reported as "no answer" before it is rethrown, so a row whose
          // request failed stops waiting like any other. The rejection still
          // reaches the wipeout check below.
          options.onRecord?.(id, null)
          throw err
        },
      ),
    ),
  )

  const records: LiveStationRecord[] = []
  const failures: unknown[] = []
  for (const outcome of settled) {
    if (outcome.status === 'rejected') failures.push(outcome.reason)
    else if (outcome.value) records.push(outcome.value)
  }

  if (records.length === 0 && failures.length > 0) throw failures[0]
  return records
}

export interface AvailabilityResult {
  /** Live fields by charger id, to merge over the shipped station. */
  live: Map<string, LiveStation>
  /** Stations asked about that the upstream did not answer for. */
  missing: string[]
}

/**
 * Fetch the live record for the given chargers.
 *
 * A station the upstream no longer knows — decommissioned, or re-issued under a
 * new id, which EnBW does in bulk — is simply absent from the result. Callers
 * must render that as unknown rather than as zero free: "never measured" and
 * "all busy" are different statements to a driver.
 */
export async function fetchAvailability(
  chargers: Pick<Charger, 'id'>[],
  options: {
    fetcher?: LiveStationFetcher
    signal?: AbortSignal
    /**
     * Per-charger progress, in charger ids rather than station ids: called as
     * each station's own lookup settles, `null` when it did not answer. Only
     * fired by a fetcher that resolves stations independently, which the
     * default one does.
     */
    onStation?: (chargerId: string, station: LiveStation | null) => void
  } = {},
): Promise<AvailabilityResult> {
  const live = new Map<string, LiveStation>()
  if (chargers.length === 0) return { live, missing: [] }

  const wanted = new Map(chargers.map((c) => [stationIdOf(c.id), c.id]))
  const { onStation } = options

  const fetcher = options.fetcher ?? fetchViaWorker
  const records = await fetcher(
    chargers.map((c) => stationIdOf(c.id)),
    {
      signal: options.signal,
      ...(onStation && {
        onRecord: (stationId, record) => {
          const chargerId = wanted.get(stationId)
          if (chargerId) onStation(chargerId, record ? toLiveStation(record) : null)
        },
      }),
    },
  )

  for (const record of records) {
    const chargerId = wanted.get(record.stationId)
    if (!chargerId) continue
    live.set(chargerId, toLiveStation(record))
  }

  return { live, missing: chargers.filter((c) => !live.has(c.id)).map((c) => c.id) }
}

/**
 * The wire record as the fields that spread onto a `Charger`.
 *
 * Rebuilt field by field rather than spread: `stationId` must not survive into
 * something that gets spread over a `Charger`, and a Worker running older code
 * may answer without the newer fields at all.
 */
function toLiveStation(record: LiveStationRecord): LiveStation {
  return {
    availablePoints: record.availablePoints,
    ...(record.totalPoints != null ? { totalPoints: record.totalPoints } : {}),
    unknownPoints: record.unknownPoints ?? 0,
    operatorCode: record.operatorCode ?? null,
    alwaysOpen: record.alwaysOpen ?? null,
    chargePoints: record.chargePoints ?? null,
  }
}
