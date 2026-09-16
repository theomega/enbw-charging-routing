import type { Route } from '../../core/route'
import { getJson, requireToken } from './client'
import type { RouteOption } from './directions'

/**
 * Traffic on a route we already have: Mapbox Directions Refresh v1.
 *
 * This exists so the app does not have to re-route to stay honest about time.
 * The route is fetched once per journey and kept; only its per-segment
 * annotations go stale, and those are exactly what this endpoint replaces.
 *
 *     GET /directions-refresh/v1/mapbox/driving-traffic/{uuid}/{route}/{leg}
 *
 * The preconditions live on the original request (see `buildDirectionsUrl`):
 * `enable_refresh=true`, the `driving-traffic` profile, `overview=full`, and a
 * distance/duration annotation. Refresh is documented for `driving-traffic`
 * only, which is the profile the route already uses.
 *
 * It returns per-leg `annotation`, `incidents`, `closures` and `notifications`
 * — no geometry and no alternatives. That is the whole point: the geometry is
 * unchanged, so the corridor placement stays valid and the route keeps its id.
 *
 * How long a `uuid` stays refreshable is not documented. A refusal is therefore
 * not an error to report but a signal to re-route, which is what `useRoutes`
 * does with a null return.
 */

export interface DirectionsRefreshResponse {
  code?: string
  message?: string
  route?: {
    legs?: ({ annotation?: { distance?: number[]; duration?: number[] } } | null)[] | null
  } | null
}

export function buildRefreshUrl(
  uuid: string,
  routeIndex: number,
  token: string,
  legIndex = 0,
): string {
  const url = new URL(
    `https://api.mapbox.com/directions-refresh/v1/mapbox/driving-traffic/${encodeURIComponent(uuid)}/${routeIndex}/${legIndex}`,
  )
  url.searchParams.set('access_token', token)
  return url.toString()
}

/**
 * The refreshed route, or null if the answer cannot be used.
 *
 * Pure, so the acceptance rules are testable without a token. Both annotation
 * arrays must be present and must describe the same number of segments the
 * route already has: the response covers the legs from `legIndex` onward, and
 * quietly grafting a partial array onto a whole route would shift every
 * along-route figure by the missing prefix. A mismatch is a null — keep the
 * annotations we have rather than publish ones that do not line up.
 *
 * Totals are re-summed rather than taken from the response, which carries none.
 * The id, uuid, index, summary and geometry are all carried over untouched:
 * this is the same route, later in the day.
 */
export function refreshedRoute(
  option: RouteOption,
  body: DirectionsRefreshResponse,
): RouteOption | null {
  const legs = body.route?.legs
  if (!Array.isArray(legs)) return null

  const distances = legs.flatMap((l) => l?.annotation?.distance ?? [])
  const durations = legs.flatMap((l) => l?.annotation?.duration ?? [])
  const segments = option.route.coordinates.length - 1
  if (distances.length !== segments || durations.length !== segments) return null

  const route: Route = {
    ...option.route,
    distances,
    durations,
    totalDistanceM: sum(distances),
    totalDurationS: sum(durations),
  }
  return { ...option, route }
}

/**
 * Re-read the traffic on one route.
 *
 * Null covers every way this can decline — no uuid to ask with, an answer that
 * does not line up, or an upstream refusal — because the caller's response to
 * all three is the same: fall back to a full re-route rather than keep numbers
 * that no longer describe the road.
 */
export async function fetchRouteRefresh(
  option: RouteOption,
  signal?: AbortSignal,
): Promise<RouteOption | null> {
  if (!option.uuid) return null
  const url = buildRefreshUrl(option.uuid, option.routeIndex, requireToken())
  const body = await getJson<DirectionsRefreshResponse>(url, signal)
  return refreshedRoute(option, body)
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
