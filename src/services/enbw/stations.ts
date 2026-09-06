import type { Charger } from '../../core/types'
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
 * The list carries identity: address, power, point count, operator. It does
 * *not* carry occupancy, which is the one thing that changes minute to minute
 * and is fetched live per station (see availability.ts).
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

export const STATION_LIST_URL = '/stations.enbw.json'

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

/** Packed on the wire: [stationId, lat, lon, maxPowerKw, address, totalPoints, operator]. */
export type PackedStation = [
  number,
  number,
  number,
  number | null,
  string | null,
  number | null,
  string | null,
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
 * different statements and the badge renders them differently. `totalPoints`,
 * by contrast, is known from the list, so a row reads "?/8" rather than "?/0"
 * before its occupancy lookup lands.
 */
export function unpackStation(row: PackedStation): Charger {
  const [stationId, lat, lon, maxPowerKw, address = null, totalPoints = 0, operator = null] = row
  return {
    id: chargerId(stationId),
    providerId: 'enbw',
    name: stationLabel(address, operator, stationId),
    address,
    lat,
    lon,
    totalPoints: totalPoints ?? 0,
    availablePoints: null,
    unknownPoints: 0,
    maxPowerKw,
    operator,
    operatorCode: null,
    priceGroup: ENBW_PRICE_GROUP,
    authMethods: [],
    alwaysOpen: false,
  }
}

export function parseStationList(file: StationListFile): StationList {
  if (!Array.isArray(file.stations)) throw new Error('Station list is malformed')
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
 * between sessions; the file is content-stamped with `version` and
 * `generatedAt`.
 *
 * Note for deployment: the file has no content hash in its name, so a long
 * `Cache-Control: max-age` on this path will hide a rebuilt list from phones
 * that already have one. See the README.
 */
export function loadStations(signal?: AbortSignal): Promise<StationList> {
  if (!cached) {
    cached = (async () => {
      const res = await fetch(STATION_LIST_URL, { signal })
      if (!res.ok) {
        throw new Error(
          `Could not load the station list (${res.status}). ` +
            `Run \`pnpm build:stations\` to generate public/stations.enbw.json.`,
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
