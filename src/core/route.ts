import { nearestPointOnLine } from '@turf/nearest-point-on-line'
import type { Feature, LineString, Position } from 'geojson'
import { fromPosition, positionDistanceM, toPoint } from './geo'
import type { LatLon } from './types'

/**
 * A driven route, and the one question the app asks of it: "if I stop here, how
 * far along am I, and how far off the road is it?".
 *
 * The route starts at your GPS position, so distance from the route start *is*
 * distance from you.
 *
 * Distance and time do not come from the geometry. Mapbox returns per-segment
 * `distance`/`duration` annotations — real road metres and traffic-aware
 * seconds — and those are what the columns show. Turf answers the geometric
 * half (where on the line a charger lands, and how far off it sits); the
 * annotations turn that position into kilometres and minutes.
 */

export interface Route {
  /** Route vertices in GeoJSON order, [lon, lat], as Mapbox returns them. */
  coordinates: Position[]
  /** Metres per segment; length is coordinates.length - 1. */
  distances: number[]
  /** Seconds per segment; length is coordinates.length - 1. */
  durations: number[]
  /** Whole-route totals, straight from Mapbox. */
  totalDistanceM: number
  totalDurationS: number
}

export interface Projection {
  /** Index of the segment the point falls on. */
  segmentIndex: number
  /** Position along that segment, 0..1. */
  t: number
  /** Metres from the point to the nearest place on the route. */
  offsetM: number
  /**
   * The nearest place on the route itself — where you would drive past if you
   * did not stop. This is what the detour is priced against (core/detour.ts),
   * so it has to be a real position and not just a distance.
   */
  point: LatLon
  alongDistanceM: number
  alongDurationS: number
}

/**
 * A route prepared for repeated queries: the Turf LineString built once, and
 * prefix sums so a segment index converts to distance/time in O(1).
 */
export interface RouteGeometry {
  route: Route
  /** The route as Turf sees it. Null for a degenerate one-vertex route. */
  line: Feature<LineString> | null
  cumDistanceM: number[]
  cumDurationS: number[]
  project(point: LatLon): Projection
}

export function buildRouteGeometry(route: Route): RouteGeometry {
  const n = route.coordinates.length
  if (n === 0) throw new Error('Cannot build geometry for an empty route')

  const cumDistanceM = new Array<number>(n).fill(0)
  const cumDurationS = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    cumDistanceM[i] = cumDistanceM[i - 1] + (route.distances[i - 1] ?? 0)
    cumDurationS[i] = cumDurationS[i - 1] + (route.durations[i - 1] ?? 0)
  }

  // Turf needs two positions to make a line. A one-vertex route is degenerate
  // but reachable (origin and destination on the same spot), so answer it
  // directly rather than letting the helper throw.
  const line: Feature<LineString> | null =
    n < 2
      ? null
      : {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: route.coordinates },
        }

  const geometry: RouteGeometry = {
    route,
    line,
    cumDistanceM,
    cumDurationS,
    project(target) {
      if (!line) {
        return {
          segmentIndex: 0,
          t: 0,
          offsetM: positionDistanceM(route.coordinates[0], [target.lon, target.lat]),
          point: fromPosition(route.coordinates[0]),
          alongDistanceM: 0,
          alongDurationS: 0,
        }
      }

      const snapped = nearestPointOnLine(line, toPoint(target), { units: 'meters' })

      // Turf reports the index of the segment's *first* vertex — except for a
      // point past the end, where it reports the last vertex, which starts no
      // segment. Clamp that onto the final segment at t = 1.
      const raw = snapped.properties.index ?? 0
      const segmentIndex = Math.min(Math.max(raw, 0), n - 2)

      const segmentStart = route.coordinates[segmentIndex]
      const segmentEnd = route.coordinates[segmentIndex + 1]
      const segmentLengthM = positionDistanceM(segmentStart, segmentEnd)
      // A zero-length segment (Mapbox does emit duplicate vertices) has no
      // meaningful fraction; t = 0 puts the charger at the shared vertex.
      const t =
        segmentLengthM === 0
          ? raw > segmentIndex
            ? 1
            : 0
          : clamp01(positionDistanceM(segmentStart, snapped.geometry.coordinates) / segmentLengthM)

      return {
        segmentIndex,
        t,
        offsetM: snapped.properties.dist ?? 0,
        point: fromPosition(snapped.geometry.coordinates),
        alongDistanceM: cumDistanceM[segmentIndex] + t * (route.distances[segmentIndex] ?? 0),
        alongDurationS: cumDurationS[segmentIndex] + t * (route.durations[segmentIndex] ?? 0),
      }
    },
  }

  return geometry
}

/** The route's vertices as `{ lat, lon }`, for callers that do not speak GeoJSON. */
export const routePoints = (route: Route): LatLon[] => route.coordinates.map(fromPosition)

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)
