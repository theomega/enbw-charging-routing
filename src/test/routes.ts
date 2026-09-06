import destination from '@turf/destination'
import { distanceM, fromPosition, toPoint } from '../core/geo'
import type { Route } from '../core/route'
import type { LatLon } from '../core/types'

/**
 * Test fixtures. Not shipped: nothing under src/ imports this except tests.
 *
 * A route heading due east along latitude 48.8 (roughly Stuttgart). Due east
 * means "along-route distance" is a pure longitude offset, which makes the
 * expected values checkable by hand.
 */
export function eastwardRoute(vertexCount = 11, stepLonDeg = 0.01): Route {
  const points: LatLon[] = []
  for (let i = 0; i < vertexCount; i++) points.push({ lat: 48.8, lon: 9.0 + i * stepLonDeg })
  return routeThrough(points)
}

/** The same route, described by its length rather than its vertex count. */
export function eastwardRouteOfKm(totalKm: number, segmentM = 733): Route {
  const points: LatLon[] = [{ lat: 48.8, lon: 9.0 }]
  const steps = Math.round((totalKm * 1_000) / segmentM)
  for (let i = 0; i < steps; i++) {
    // Due east is bearing 90.
    points.push(fromPosition(
      destination(toPoint(points[i]), segmentM, 90, { units: 'meters' }).geometry.coordinates,
    ))
  }
  return routeThrough(points)
}

/** Annotate a path with a flat 90 km/h, so time is a clean function of distance. */
function routeThrough(points: LatLon[]): Route {
  const distances: number[] = []
  for (let i = 0; i < points.length - 1; i++) distances.push(distanceM(points[i], points[i + 1]))
  const durations = distances.map((d) => d / 25)
  return {
    coordinates: points.map((p) => [p.lon, p.lat]),
    distances,
    durations,
    totalDistanceM: distances.reduce((a, b) => a + b, 0),
    totalDurationS: durations.reduce((a, b) => a + b, 0),
  }
}
