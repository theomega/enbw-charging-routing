import type { Charger } from '../../core/types'
import { stationIdOf } from './wire'

/**
 * Live occupancy for a known set of stations — and nothing else.
 *
 * This used to fetch bounding boxes, because a box could in principle cover
 * several nearby stations for one request. Measured on a real route it covers
 * exactly one: corridor candidates are kilometres apart, so 17 stations cost 17
 * boxes. The boxes bought nothing and cost everything, because a box is answered
 * through EnBW's clustering grid — any grid cell holding two stations collapses
 * into a placeholder with no id and no occupancy, and the row it belonged to
 * lost its identity along with its badge.
 *
 * Asking for one station by id has the same request count, the same latency,
 * and no grouping at all. A station id that no longer exists simply 404s
 * upstream and is absent here, which the caller renders as "?/n" — the rest of
 * the row is already known from the shipped list.
 */

/** The only thing that changes minute to minute. */
export interface Occupancy {
  /**
   * Points free right now. Null is impossible here — an absent station is
   * absent from the map — but `Charger.availablePoints` is nullable because the
   * shipped list cannot know it.
   */
  availablePoints: number
  /** Omitted when upstream does not report it, so the list's count survives. */
  totalPoints?: number
  unknownPoints: number
}

/** Wire shape of the Worker's reply: occupancy per station id. */
export interface OccupancyRecord extends Occupancy {
  stationId: number
}

export type OccupancyFetcher = (
  stationIds: number[],
  signal?: AbortSignal,
) => Promise<OccupancyRecord[]>

/** Default fetcher: through the Worker, which holds the key and the Origin. */
export const fetchViaWorker: OccupancyFetcher = async (stationIds, signal) => {
  const res = await fetch('/api/chargers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stationIds }),
    signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Availability lookup failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  const body = (await res.json()) as { stations: OccupancyRecord[] }
  return body.stations
}

export interface AvailabilityResult {
  /** Occupancy by charger id, to merge over the shipped station. */
  live: Map<string, Occupancy>
  /** Stations asked about that the upstream did not answer for. */
  missing: string[]
}

/**
 * Fetch occupancy for the given chargers.
 *
 * A station the upstream no longer knows — decommissioned, or re-issued under a
 * new id, which EnBW does in bulk — is simply absent from the result. Callers
 * must render that as unknown rather than as zero free: "never measured" and
 * "all busy" are different statements to a driver.
 */
export async function fetchAvailability(
  chargers: Pick<Charger, 'id'>[],
  options: { fetcher?: OccupancyFetcher; signal?: AbortSignal } = {},
): Promise<AvailabilityResult> {
  const live = new Map<string, Occupancy>()
  if (chargers.length === 0) return { live, missing: [] }

  const fetcher = options.fetcher ?? fetchViaWorker
  const records = await fetcher(
    chargers.map((c) => stationIdOf(c.id)),
    options.signal,
  )

  const wanted = new Map(chargers.map((c) => [stationIdOf(c.id), c.id]))
  for (const record of records) {
    const chargerId = wanted.get(record.stationId)
    if (!chargerId) continue
    live.set(chargerId, {
      availablePoints: record.availablePoints,
      ...(record.totalPoints != null ? { totalPoints: record.totalPoints } : {}),
      unknownPoints: record.unknownPoints ?? 0,
    })
  }

  return { live, missing: chargers.filter((c) => !live.has(c.id)).map((c) => c.id) }
}
