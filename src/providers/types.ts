/**
 * Provider-neutral charger model.
 *
 * Everything downstream of this file (corridor maths, detour, UI) speaks only
 * `Charger`. The EnBW adapter is the only place that knows about EnBW's wire
 * format, so a second source (e.g. Open Charge Map) can be added by writing
 * another adapter and nothing else.
 */

export interface LatLon {
  lat: number
  lon: number
}

/** A geographic bounding box, as the EnBW endpoint expects it. */
export interface Tile {
  fromLat: number
  toLat: number
  fromLon: number
  toLon: number
}

export interface Charger extends LatLon {
  /** Stable id, namespaced by provider, e.g. "enbw:436595". */
  id: string
  providerId: 'enbw'
  name: string
  address: string | null
  /** Total charge points at this station. */
  totalPoints: number
  /**
   * Points reported free right now. `null` when the provider has no live data
   * at all — distinct from 0, which means "known, and all busy".
   */
  availablePoints: number | null
  /** Points whose state the provider could not determine. */
  unknownPoints: number
  maxPowerKw: number | null
  plugTypes: string[]
  operator: string | null
  operatorCode: string | null
  priceGroup: string | null
  authMethods: string[]
  alwaysOpen: boolean
}

/**
 * How a charger relates to the current route. Produced by routing/corridor.ts
 * (the local, free part) and routing/detour.ts (the Matrix-priced part).
 */
export interface ChargerOnRoute {
  charger: Charger
  /** Metres from the route start (= your position) to the exit point. */
  alongDistanceM: number
  /** Seconds from the route start to the exit point. */
  alongDurationS: number
  /** Crow-fly metres from the route to the charger. */
  offsetM: number
  /**
   * Extra seconds of driving incurred by stopping here.
   * `null` until priced, or when Mapbox could not route to the point.
   */
  detourS: number | null
}

export interface ChargerProvider {
  readonly id: 'enbw'
  readonly label: string
  /** Fetch every charger inside the given tiles, deduplicated. */
  fetchInTiles(tiles: Tile[], signal?: AbortSignal): Promise<Charger[]>
}
