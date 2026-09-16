import stationListUrl from '../../../data/stations.enbw.json?url'
import type { Charger, PointPowerGroup } from '../../core/types'
import { ENBW_PRICE_GROUP, chargerId } from './wire'

/**
 * The static EnBW station list — and the app's source of truth for *who a
 * station is*.
 *
 * The app used to discover chargers at runtime by tiling the route corridor and
 * asking EnBW what was inside each box — hundreds of requests per route, and a
 * long tail of bugs around coverage gaps and the API's cluster placeholders.
 * The station set barely changes, so it is generated offline by
 * `scripts/build-station-list.mjs` and shipped as data.
 *
 * The list carries identity: location, address, power, the points at their own
 * powers, operator. It does *not* carry occupancy, which is the one thing that
 * changes minute to minute and is fetched live per station (see
 * availability.ts).
 *
 * That split is deliberate and was learned the hard way. Identity used to come
 * from the live call too, joined by station id, so any hiccup in that call —
 * a cluster placeholder, or an id EnBW had quietly re-issued — left a row
 * reading "Station 2970018" with no address. Identity has nothing to do with
 * the network, so it no longer depends on it.
 *
 * It also carries only stations at `MIN_STATION_POWER_KW` or above. An 11 or
 * 22 kW AC post is an overnight charger, not a stop on a long drive, and half
 * the EnBW network is below that line — leaving it out halves both the download
 * and the corridor geometry.
 */

/**
 * The built file, not the source path. Vite copies `data/stations.enbw.json`
 * into the bundle's asset directory under a content-hashed name, which is what
 * lets it be cached forever (see `public/_headers`): a rebuilt list ships as a
 * different URL rather than as the same URL with new contents.
 */
export const STATION_LIST_URL = stationListUrl

/**
 * The oldest file format this app can read.
 *
 * Version 5 replaced a column rather than appending one, so a version 4 file
 * does not degrade — it mis-parses, silently, reading the old point count as
 * the operator name and shifting everything after it along. There is no
 * migration on purpose: the app is in testing, the file is committed alongside
 * the code that reads it, and the only cost of refusing it is a rebuild.
 *
 * Worth being strict about even though the file is now content-hashed and
 * fetched by a URL the bundle names: the check costs nothing and a shifted row
 * would put a number where a station's operator goes. A hard error names the fix.
 */
export const MIN_LIST_VERSION = 5

/**
 * The floor the list is built to. `scripts/build-station-list.mjs` applies it,
 * and `parseStationList` applies it again so the invariant holds whatever file
 * is actually served.
 */
export const MIN_STATION_POWER_KW = 50

export interface StationListMeta {
  version: number
  generatedAt: string
  count: number
}

/**
 * The points of one station by power, packed as [maxPowerKw, count] pairs —
 * [[300, 4], [22, 4]] for a hub with four fast stalls and four AC posts. A null
 * power is a point the provider reports none for.
 */
export type PackedPointPowers = [number | null, number][]

/**
 * Packed on the wire:
 * [stationId, lat, lon, maxPowerKw, address, operator, location, points].
 *
 * `points` replaced a `totalPoints` column in file version 5, and the two are
 * not interchangeable: the old column came from the bulk query, which counts
 * only the points matching the `minPowerInKw` it was asked with, so it was a
 * 50 kW-filtered figure sitting under the name "total". `points` sums to the
 * station's real size and can be filtered to any setting.
 *
 * The trailing two are optional, so a row that stops short still parses: a
 * station whose detail lookup failed during the build carries no `points` and
 * renders "?" until a live lookup answers for it.
 */
export type PackedStation = [
  number,
  number,
  number,
  number | null,
  string | null,
  string | null,
  (string | null)?,
  (PackedPointPowers | null)?,
]

export interface StationListFile {
  version: number
  generatedAt: string
  count: number
  minPowerKw?: number
  fields: string[]
  stations: PackedStation[]
}

export interface StationList {
  meta: StationListMeta
  /** Every shipped station, fully described except for live occupancy. */
  chargers: Charger[]
}

/**
 * The fallback label, for a station with no location line of its own.
 *
 * EnBW has no station name field. The street part of the address is the most
 * recognisable label, with the operator and then the bare id as fallbacks.
 */
export function stationLabel(
  address: string | null,
  operator: string | null,
  stationId: number,
): string {
  return address?.split(',')[0]?.trim() || operator || `Station ${stationId}`
}

/**
 * One packed row as a `Charger`.
 *
 * `availablePoints` is null, never 0: "not measured yet" and "all busy" are
 * different statements and the badge renders them differently. How many points
 * the station has, by contrast, is known from the list, so a row reads "?/4"
 * rather than "?/0" before its occupancy lookup lands — and "4" there is
 * already the count the Ladeleistung setting leaves, because the points ship
 * with the row at their own powers.
 */
export function unpackStation(row: PackedStation): Charger {
  const [
    stationId,
    lat,
    lon,
    maxPowerKw,
    address = null,
    operator = null,
    location = null,
    points = null,
  ] = row
  return {
    id: chargerId(stationId),
    providerId: 'enbw',
    name: stationLabel(address, operator, stationId),
    address,
    lat,
    lon,
    availablePoints: null,
    unknownPoints: 0,
    maxPowerKw,
    operator,
    // Not in the packed row — the live record is the only source. Null rather
    // than false, so the UI can say "unknown" instead of asserting something
    // the list never knew.
    operatorCode: null,
    priceGroup: ENBW_PRICE_GROUP,
    alwaysOpen: null,
    chargePoints: null,
    // The station's points at their own powers, which is both its size and what
    // the displayed count is filtered by — on every row, rather than only on
    // the ones a live lookup has reached. See core/points.ts.
    pointPowers: unpackPointPowers(points),
    // The heading the UI renders. In the list precisely so it never changes
    // under the driver: it used to come from the live lookup, so a row opened
    // its detail panel and its own title moved.
    notes: location,
  }
}

/**
 * Null rather than an empty array when the field is missing, so a row from an
 * older file reads as "not in this list" instead of asserting that the station
 * has no points at all.
 */
function unpackPointPowers(packed: PackedPointPowers | null | undefined): PointPowerGroup[] | null {
  if (!Array.isArray(packed)) return null
  return packed.map(([maxPowerKw, count]) => ({ maxPowerKw, count }))
}

export function parseStationList(file: StationListFile): StationList {
  if (!Array.isArray(file.stations)) throw new Error('Station list is malformed')
  if (!(file.version >= MIN_LIST_VERSION)) {
    throw new Error(
      `Station list is version ${file.version}, and this app needs ${MIN_LIST_VERSION} or ` +
        `newer. Run \`pnpm build:stations\` to regenerate data/stations.enbw.json.`,
    )
  }
  return {
    meta: { version: file.version, generatedAt: file.generatedAt, count: file.count },
    chargers: file.stations
      .map(unpackStation)
      .filter((c) => (c.maxPowerKw ?? 0) >= MIN_STATION_POWER_KW),
  }
}

let cached: Promise<StationList> | null = null

/**
 * Load the list, once per session. The browser HTTP cache handles persistence
 * between sessions, and the URL is content-hashed, so a phone keeps its copy
 * until a rebuild gives the file a new name.
 */
export function loadStations(signal?: AbortSignal): Promise<StationList> {
  if (!cached) {
    cached = (async () => {
      const res = await fetch(STATION_LIST_URL, { signal })
      if (!res.ok) {
        throw new Error(
          `Could not load the station list (${res.status}). ` +
            `Run \`pnpm build:stations\` to generate data/stations.enbw.json.`,
        )
      }
      return parseStationList((await res.json()) as StationListFile)
    })().catch((err) => {
      // Never cache a failure, or a transient network error would persist for
      // the whole session.
      cached = null
      throw err
    })
  }
  return cached
}

/** Test seam. */
export function resetStationListCache(): void {
  cached = null
}
