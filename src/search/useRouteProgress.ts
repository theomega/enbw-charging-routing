import { useMemo } from 'react'
import { routeProgress, type RouteProgress } from '../core/progress'
import { buildRouteGeometry } from '../core/route'
import type { LatLon } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'

/**
 * Where the driver is on the selected route.
 *
 * Two memos rather than one, because the two halves cost very different
 * things. The geometry — prefix sums over a few thousand segments — is built
 * once per route object and survives every GPS tick. The projection is one
 * `nearestPointOnLine` against that geometry, roughly 5–15 ms on a phone, and
 * runs per tick; `useGeolocation` already throttles those to ~50 m of movement,
 * so it is a few times a minute at motorway speed.
 *
 * A refreshed route is a new object with the same id (see `directionsRefresh`),
 * which is exactly the right cache behaviour here: the annotations changed, so
 * the prefix sums have to be rebuilt.
 */
export function useRouteProgress(
  selected: RouteOption | null,
  position: LatLon | null,
): RouteProgress | null {
  const geometry = useMemo(() => (selected ? buildRouteGeometry(selected.route) : null), [selected])

  return useMemo(
    () => (geometry && position ? routeProgress(geometry, position) : null),
    [geometry, position],
  )
}
