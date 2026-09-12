import { describe, expect, it } from 'vitest'
import { eastwardRoute } from '../test/routes'
import { buildRouteGeometry, routePoints, type Route } from './route'

describe('buildRouteGeometry', () => {
  it('accumulates distance and duration so the last vertex matches the totals', () => {
    const route = eastwardRoute()
    const geometry = buildRouteGeometry(route)
    expect(geometry.cumDistanceM[0]).toBe(0)
    expect(geometry.cumDurationS[0]).toBe(0)
    expect(geometry.cumDistanceM.at(-1)).toBeCloseTo(route.totalDistanceM, 6)
    expect(geometry.cumDurationS.at(-1)).toBeCloseTo(route.totalDurationS, 6)
  })

  it('refuses an empty route rather than producing a silent zero', () => {
    expect(() =>
      buildRouteGeometry({
        coordinates: [],
        distances: [],
        durations: [],
        totalDistanceM: 0,
        totalDurationS: 0,
      }),
    ).toThrow(/empty route/)
  })

  it('exposes the vertices as lat/lon, not raw GeoJSON pairs', () => {
    expect(routePoints(eastwardRoute(2))[0]).toEqual({ lat: 48.8, lon: 9.0 })
  })
})

describe('RouteGeometry.project', () => {
  it('puts a charger sitting exactly on the route at ~zero offset', () => {
    const onRoute = buildRouteGeometry(eastwardRoute()).project({ lat: 48.8, lon: 9.05 })
    expect(onRoute.offsetM).toBeLessThan(1)
  })

  it('reports along-route distance matching the cumulative annotation', () => {
    const route = eastwardRoute()
    // Vertex 5 is exactly five segments in.
    const expected = route.distances.slice(0, 5).reduce((a, b) => a + b, 0)
    const p = buildRouteGeometry(route).project({ lat: 48.8, lon: 9.05 })
    expect(p.alongDistanceM).toBeCloseTo(expected, 0)
    expect(p.alongDurationS).toBeCloseTo(expected / 25, 0)
  })

  it('interpolates within a segment instead of snapping to a vertex', () => {
    const route = eastwardRoute()
    // Halfway between vertex 3 and 4.
    const p = buildRouteGeometry(route).project({ lat: 48.8, lon: 9.035 })
    expect(p.segmentIndex).toBe(3)
    expect(p.t).toBeCloseTo(0.5, 2)
    const expected =
      route.distances.slice(0, 3).reduce((a, b) => a + b, 0) + 0.5 * route.distances[3]
    expect(p.alongDistanceM).toBeCloseTo(expected, 0)
  })

  it('reports the point on the route, which is what the detour is priced against', () => {
    const geometry = buildRouteGeometry(eastwardRoute())
    // 0.009 degrees of latitude north is almost exactly 1 km off an east-west
    // route, so the nearest point on the road is due south of the charger.
    const p = geometry.project({ lat: 48.809, lon: 9.05 })
    expect(p.point.lat).toBeCloseTo(48.8, 5)
    expect(p.point.lon).toBeCloseTo(9.05, 5)
  })

  it('falls back to the only vertex on a degenerate one-point route', () => {
    const single: Route = {
      coordinates: [[9.0, 48.8]],
      distances: [],
      durations: [],
      totalDistanceM: 0,
      totalDurationS: 0,
    }
    expect(buildRouteGeometry(single).project({ lat: 48.81, lon: 9.0 }).point).toEqual({
      lat: 48.8,
      lon: 9.0,
    })
  })

  it('measures ground offset for a charger beside the route', () => {
    const geometry = buildRouteGeometry(eastwardRoute())
    // 0.009 degrees of latitude north is almost exactly 1 km.
    const p = geometry.project({ lat: 48.809, lon: 9.05 })
    expect(p.offsetM).toBeGreaterThan(950)
    expect(p.offsetM).toBeLessThan(1050)
  })

  it('clamps to the route ends rather than extrapolating past them', () => {
    const route = eastwardRoute()
    const geometry = buildRouteGeometry(route)

    const before = geometry.project({ lat: 48.8, lon: 8.9 })
    expect(before.alongDistanceM).toBeCloseTo(0, 6)

    // Past the far end Turf reports the last *vertex*, which starts no segment.
    const after = geometry.project({ lat: 48.8, lon: 9.2 })
    expect(after.segmentIndex).toBe(route.coordinates.length - 2)
    expect(after.t).toBe(1)
    expect(after.alongDistanceM).toBeCloseTo(route.totalDistanceM, 0)
  })

  it('handles a degenerate single-vertex route without dividing by zero', () => {
    const route: Route = {
      coordinates: [[9.0, 48.8]],
      distances: [],
      durations: [],
      totalDistanceM: 0,
      totalDurationS: 0,
    }
    const p = buildRouteGeometry(route).project({ lat: 48.81, lon: 9.0 })
    expect(Number.isFinite(p.offsetM)).toBe(true)
    expect(p.offsetM).toBeGreaterThan(1_000)
    expect(p.alongDistanceM).toBe(0)
  })

  it('handles duplicate consecutive coordinates, which Mapbox does emit', () => {
    const route: Route = {
      coordinates: [
        [9.0, 48.8],
        [9.0, 48.8],
        [9.01, 48.8],
      ],
      distances: [0, 733],
      durations: [0, 29],
      totalDistanceM: 733,
      totalDurationS: 29,
    }
    const p = buildRouteGeometry(route).project({ lat: 48.8, lon: 9.005 })
    expect(Number.isFinite(p.alongDistanceM)).toBe(true)
    expect(p.alongDistanceM).toBeGreaterThan(0)
    expect(p.offsetM).toBeLessThan(5)
  })
})
