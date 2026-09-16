import { distanceM } from './geo'
import type { Route, RouteGeometry } from './route'
import type { ChargerOnRoute, LatLon } from './types'

/**
 * Where the driver is on a route that is not going to be re-fetched.
 *
 * The app used to move the route's start point to the driver instead: a fresh
 * Directions request every two kilometres, which made "distance from the route
 * start" mean "distance from you" for free. It cost a new route object each
 * time — new ids, a missed placement cache, an unmounted list — and it silently
 * discarded any alternative the driver had picked.
 *
 * None of that was buying anything the geometry cannot answer locally. One
 * route per journey, `nearestPointOnLine` against it — which the corridor
 * already runs for every station on this same line — and the driver's own
 * progress is a subtraction away.
 *
 * Nothing here touches the network or React. `alongDistanceM` and
 * `alongDurationS` come from the same prefix sums over Mapbox's per-segment
 * annotations that place the stations, so the driver and the stations are
 * measured by one ruler.
 */

export interface RouteProgress {
  /** Metres driven along the route, from its start. */
  alongDistanceM: number
  /** Seconds of that, by the route's own annotations. */
  alongDurationS: number
  /** Metres from the driver to the route line. The deviation measure. */
  offRouteM: number
}

/**
 * How far off the line the route stops describing the drive.
 *
 * Comfortably inside `DEFAULT_MAX_OFFSET_M`, so the station list is still
 * meaningful while the offer to re-route is on screen — and well past any
 * plausible GPS error or carriageway offset.
 */
export const OFF_ROUTE_M = 2_000

/**
 * How far past a station's route point it stays in the list.
 *
 * Driving to a charger means leaving the route, so the station being stopped at
 * is the one most likely to fall behind the driver — and it must not vanish
 * from the app while they are standing at it. Measured to the station itself,
 * not to its route point, so it is the arrival that keeps the row rather than
 * the distance driven past the exit.
 *
 * It also absorbs GPS jitter at the moment of passing, which would otherwise
 * flicker a row in and out of the list.
 */
export const PASSED_GRACE_M = 1_000

export function routeProgress(geometry: RouteGeometry, position: LatLon): RouteProgress {
  const projection = geometry.project(position)
  return {
    alongDistanceM: projection.alongDistanceM,
    alongDurationS: projection.alongDurationS,
    offRouteM: projection.offsetM,
  }
}

export const isOffRoute = (progress: RouteProgress, thresholdM = OFF_ROUTE_M): boolean =>
  progress.offRouteM > thresholdM

/** What is left of the route from where the driver is. */
export function remainingRoute(
  route: Route,
  progress: RouteProgress,
): { distanceM: number; durationS: number } {
  return {
    distanceM: Math.max(0, route.totalDistanceM - progress.alongDistanceM),
    durationS: Math.max(0, route.totalDurationS - progress.alongDurationS),
  }
}

/**
 * The stations still ahead, with their along-route figures measured from the
 * driver rather than from the route's start.
 *
 * Both jobs in one pass because they are one idea. `ChargerOnRoute`'s
 * along-route fields are documented as distance and time *from you*, and with
 * a fixed route that is no longer what the placement measured — so every
 * consumer would otherwise have to remember to subtract, which is the sort of
 * thing that gets remembered in three call sites out of four.
 *
 * Clamped at zero rather than left negative: a station kept by the grace above
 * has been passed, and "in 0 m" is the honest reading for one the driver is
 * standing at. A negative distance would sort and format as something else
 * entirely.
 *
 * Order is preserved, so the result is still route order — which is what makes
 * "the first n" mean "the next n you will reach".
 */
export function aheadOfDriver(
  items: ChargerOnRoute[],
  progress: RouteProgress,
  position: LatLon,
  graceM = PASSED_GRACE_M,
): ChargerOnRoute[] {
  const out: ChargerOnRoute[] = []
  for (const item of items) {
    const alongDistanceM = item.alongDistanceM - progress.alongDistanceM
    if (alongDistanceM < 0 && distanceM(position, item.charger) > graceM) continue
    out.push({
      ...item,
      alongDistanceM: Math.max(0, alongDistanceM),
      alongDurationS: Math.max(0, item.alongDurationS - progress.alongDurationS),
    })
  }
  return out
}
