/**
 * The vocabulary of the app.
 *
 * Everything above this file — corridor maths, detour pricing, the UI — speaks
 * only these types. Wire formats stay inside `src/services/*`, so a second
 * charger source or a different routing provider is an adapter and nothing else.
 */

/** A position, in the order humans say it. Turf wants [lon, lat]; see core/geo.ts. */
export interface LatLon {
  lat: number
  lon: number
}

/** A geocoded destination. Persisted in the store, so keep it plain and small. */
export interface Place extends LatLon {
  id: string
  name: string
  /** Full formatted address, for the second line in the picker. */
  context: string
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
  operator: string | null
  operatorCode: string | null
  priceGroup: string | null
  authMethods: string[]
  alwaysOpen: boolean
}

/**
 * How a charger relates to the route you are driving. Produced by
 * `core/corridor.ts` (free, local geometry) and priced by `core/detour.ts`
 * (costs Mapbox Matrix quota).
 */
export interface ChargerOnRoute {
  charger: Charger
  /** Metres from the route start (= your position) to the exit point. */
  alongDistanceM: number
  /** Seconds from the route start to the exit point. */
  alongDurationS: number
  /** Metres from the route to the charger, measured on the ground. */
  offsetM: number
  /**
   * Extra seconds of driving incurred by stopping here.
   * `null` until priced, or when Mapbox could not route to the point.
   */
  detourS: number | null
}
