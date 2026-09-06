import type { Route } from '../../core/route'
import type { LatLon } from '../../core/types'
import { MapboxError, coordPair, getJson, requireToken } from './client'

/** Routing: Mapbox Directions v5, `driving-traffic`, with alternatives. */

export interface DirectionsResponse {
  code?: string
  message?: string
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
  /** Stable across re-renders without relying on array position alone. */
  id: string
  route: Route
  /** Major roads, e.g. "A22, SS12" — what distinguishes Jaufenpass from Brenner. */
  summary: string
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
  return url.toString()
}

/** Pure response mapping, split out so it is testable without a token. */
export function mapDirectionsRoutes(body: DirectionsResponse): RouteOption[] {
  if (!body.routes?.length) {
    throw new MapboxError(body.message ?? 'No route found between those two points.')
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
      id: `${index}-${Math.round(route.distance)}-${Math.round(route.duration)}`,
      summary,
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
