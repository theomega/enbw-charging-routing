import type { Route } from '../../core/route'
import type { LatLon } from '../../core/types'
import { MapboxError, coordPair, getJson, requireToken } from './client'

/** Routing: Mapbox Directions v5, `driving-traffic`, with alternatives. */

export interface DirectionsResponse {
  code?: string
  message?: string
  /**
   * Identifies this *response*, not any route in it. Mapbox: "Combination of
   * `uuid` and the index in `routes` array uniquely identifies the route" — so
   * it is the handle the Refresh endpoint takes, and it is meaningless across
   * two requests. Absent from older fixtures and from a response built without
   * `enable_refresh`, hence optional.
   */
  uuid?: string
  routes: {
    distance: number
    duration: number
    geometry: { coordinates: [number, number][] }
    legs: {
      /** "A summary of major roads traversed", e.g. "A22, SS12". */
      summary?: string
      annotation?: { distance?: number[]; duration?: number[] }
    }[]
  }[]
}

/** One way of getting there. Mapbox returns up to three, best first. */
export interface RouteOption {
  /**
   * Identity for React keys and for the placement and detour caches.
   *
   * Derived from the response `uuid` plus the array index, which is Mapbox's
   * own notion of route identity and the only one it has. That matters beyond
   * tidiness: the id must *not* move when a traffic refresh changes the route's
   * duration, or refreshing the ETA would silently invalidate every cache keyed
   * on it. The old `index-distance-duration` scheme did exactly that, and
   * survives as the fallback for a response with no uuid.
   */
  id: string
  route: Route
  /** Major roads, e.g. "A22, SS12" — what distinguishes Jaufenpass from Brenner. */
  summary: string
  /**
   * The response this route came out of, for `directionsRefresh.ts`. Null when
   * Mapbox returned none, which is what makes traffic refresh unavailable
   * rather than broken.
   */
  uuid: string | null
  /** Its index in that response — the other half of the refresh handle. */
  routeIndex: number
}

/**
 * Every route Mapbox will offer from origin to destination.
 *
 * `alternatives=true` returns up to two alternatives (three routes total),
 * ordered by descending recommendation rank, at no extra request cost. They are
 * not guaranteed — a motorway-only trip often yields exactly one — so callers
 * must handle a single-element array.
 *
 * `driving-traffic` gives a realistic ETA. The per-segment annotations are what
 * make the along-route distance/time columns free — see core/route.ts.
 */
export function buildDirectionsUrl(origin: LatLon, destination: LatLon, token: string): string {
  const path = `${coordPair(origin)};${coordPair(destination)}`
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${encodeURIComponent(path)}`,
  )
  url.searchParams.set('access_token', token)
  url.searchParams.set('geometries', 'geojson')
  url.searchParams.set('overview', 'full')
  url.searchParams.set('annotations', 'distance,duration')
  url.searchParams.set('alternatives', 'true')
  url.searchParams.set('steps', 'false')
  // The only thing that makes the response's `uuid` refreshable afterwards. The
  // other preconditions the Refresh endpoint has — `driving-traffic`,
  // `overview=full`, and a distance/duration annotation — are already above.
  url.searchParams.set('enable_refresh', 'true')
  return url.toString()
}

/** Pure response mapping, split out so it is testable without a token. */
export function mapDirectionsRoutes(body: DirectionsResponse): RouteOption[] {
  if (!body.routes?.length) {
    throw new MapboxError(body.message ?? 'Für dieses Ziel wurde keine Route gefunden.')
  }

  return body.routes.map((route, index) => {
    // Annotations come per leg; with a single destination there is exactly one.
    const distances = route.legs.flatMap((l) => l.annotation?.distance ?? [])
    const durations = route.legs.flatMap((l) => l.annotation?.duration ?? [])
    const summary = route.legs
      .map((l) => l.summary?.trim())
      .filter((x): x is string => !!x)
      .join(', ')

    return {
      id: body.uuid
        ? `${body.uuid}-${index}`
        : `${index}-${Math.round(route.distance)}-${Math.round(route.duration)}`,
      summary,
      uuid: body.uuid ?? null,
      routeIndex: index,
      route: {
        coordinates: route.geometry.coordinates,
        distances,
        durations,
        totalDistanceM: route.distance,
        totalDurationS: route.duration,
      },
    }
  })
}

export async function fetchRoutes(
  origin: LatLon,
  destination: LatLon,
  signal?: AbortSignal,
): Promise<RouteOption[]> {
  const url = buildDirectionsUrl(origin, destination, requireToken())
  return mapDirectionsRoutes(await getJson<DirectionsResponse>(url, signal))
}
