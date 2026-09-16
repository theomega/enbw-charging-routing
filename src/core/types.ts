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

/**
 * One physical charge point at a station.
 *
 * Only the live record carries these — the shipped list is station-level, so a
 * charger straight out of `unpackStation` has `chargePoints: null`. That is
 * "not fetched", which is a different statement from "this station has none".
 */
export interface ChargePoint {
  /** Provider's own id for the point, when it gives one. */
  id: string | null
  /** Connector names as the provider words them, e.g. "CCS (Typ 2)". */
  plugs: string[]
  maxPowerKw: number | null
  /** Provider status verbatim, e.g. "AVAILABLE". Null when unreported. */
  status: string | null
}

/**
 * How many charge points a station has at each power figure.
 *
 * The shipped list's answer to the same question the live record answers point
 * by point. It exists because the power of a point and the power of a *station*
 * are different numbers: a motorway hub is listed at 300 kW and keeps 22 kW AC
 * posts beside the fast stalls, so its point count says nothing about how many
 * points the driver's Ladeleistung setting actually leaves.
 *
 * Built offline by `scripts/build-station-list.mjs`, which already fetches each
 * station's detail record for its location line — the powers come out of the
 * same response, so the list carries them for no extra request. Deliberately
 * not statuses: those change minute to minute and belong to the live lookup.
 *
 * This is also the station's *size*: the counts sum to how many points it has.
 * There is deliberately no separate total beside it. The one the list used to
 * carry came from the bulk query's `allChargePointCount`, which — measured
 * against both endpoints — silently counts only the points matching the
 * `minPowerInKw` the query was made with, so a field named "total" held a
 * 50 kW-filtered figure that the live record then overwrote with the real one.
 * A number whose meaning changed when a lookup landed is worse than no number.
 */
export interface PointPowerGroup {
  /** Null when the provider reports no power for these points. */
  maxPowerKw: number | null
  count: number
}

export interface Charger extends LatLon {
  /** Stable id, namespaced by provider, e.g. "enbw:436595". */
  id: string
  providerId: 'enbw'
  name: string
  address: string | null
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
  /**
   * Null means "never fetched", not "no". Neither this nor `operatorCode` is in
   * the shipped list — they arrive only with the live record, so a row that has
   * not been enriched must render them as unknown rather than as a fact.
   *
   * There is deliberately no price here. EnBW's endpoint does return a
   * `pricingInfo` block, and it is wrong for most drivers: what a charge costs
   * depends on the tariff the driver is on, which this app cannot know. The
   * same goes for the authentication methods it lists. Showing either would be
   * stating someone else's contract as though it were this one's.
   */
  alwaysOpen: boolean | null
  /**
   * The individual points, when the live record has been fetched. Null means
   * "never asked" — only the rows inside `ENRICHED_LIMIT`, plus any charger
   * whose detail panel has been opened, ever carry this.
   */
  chargePoints: ChargePoint[] | null
  /**
   * The station's points by power, from the shipped list — so this is known for
   * every row, enriched or not, and is what the point count is filtered by.
   *
   * Null means the list file predates the field (a phone still serving a cached
   * copy), not that the station has no points. A row in that state falls back
   * to the station-level count; see `core/points.ts`.
   */
  pointPowers: PointPowerGroup[] | null
  /** Free-text location hint from the provider, e.g. "ENI Schottwien". */
  notes: string | null
}

/**
 * The real driving legs either side of a stop, out of the same Matrix call that
 * prices `detourS` — so they cost nothing extra and, crucially, they are on the
 * same `driving` profile as the detour. Do not compare them with the route's
 * headline figures, which are `driving-traffic`.
 *
 * Null on rows past `ENRICHED_LIMIT`, which are never priced.
 */
export interface ChargerLegs {
  /** Metres from where you are now to the charger, by road. */
  toChargerM: number | null
  toChargerS: number | null
  /** Metres from the charger on to the final destination, by road. */
  fromChargerM: number | null
  fromChargerS: number | null
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
   * Where this charger meets the route: the nearest point on the selected
   * route's geometry. It is what you drive past if you do not stop, and so it
   * is the baseline the detour is measured against — see core/detour.ts.
   */
  routePoint: LatLon
  /**
   * Extra seconds of driving incurred by stopping here. Negative where the
   * baseline leg did not take the road the driver will — core/detour.ts says
   * how that happens and why the sign is kept.
   * `null` until priced, or when Mapbox could not route to the point.
   */
  detourS: number | null
  /** Extra metres driven by stopping here. Signed and null on `detourS`'s terms. */
  detourM: number | null
  /** The two legs the detour was computed from. Null until priced. */
  legs: ChargerLegs | null
}
