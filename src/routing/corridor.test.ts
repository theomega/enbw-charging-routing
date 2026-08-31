import { describe, expect, it } from 'vitest'
import {
  buildRouteIndex,
  haversineM,
  placeChargersOnRoute,
  projectOntoRoute,
  sampleRoute,
  tilesForRoute,
  type Route,
} from './corridor'
import type { Charger } from '../providers/types'

/**
 * A synthetic route heading due east along latitude 48.8 (roughly Stuttgart).
 * Due east means "along-route distance" is a pure longitude offset, which makes
 * the expected values checkable by hand.
 */
function eastwardRoute(vertexCount = 11, stepLonDeg = 0.01): Route {
  const coordinates: [number, number][] = []
  for (let i = 0; i < vertexCount; i++) coordinates.push([9.0 + i * stepLonDeg, 48.8])

  const distances: number[] = []
  const durations: number[] = []
  for (let i = 0; i < vertexCount - 1; i++) {
    const d = haversineM(
      { lat: coordinates[i][1], lon: coordinates[i][0] },
      { lat: coordinates[i + 1][1], lon: coordinates[i + 1][0] },
    )
    distances.push(d)
    durations.push(d / 25) // a flat 90 km/h, so time is a clean function of distance
  }
  return {
    coordinates,
    distances,
    durations,
    totalDistanceM: distances.reduce((a, b) => a + b, 0),
    totalDurationS: durations.reduce((a, b) => a + b, 0),
  }
}

function charger(id: string, lat: number, lon: number): Charger {
  return {
    id,
    providerId: 'enbw',
    name: id,
    address: null,
    lat,
    lon,
    totalPoints: 4,
    availablePoints: 2,
    unknownPoints: 0,
    maxPowerKw: 150,
    plugTypes: ['CCS'],
    operator: 'EnBW',
    operatorCode: 'DEEBW',
    priceGroup: 'ENBW_GROUP',
    authMethods: ['MOBILITY_PLUS_CHARGE_CARD'],
    alwaysOpen: true,
  }
}

describe('buildRouteIndex', () => {
  it('accumulates distance and duration so the last vertex matches the totals', () => {
    const route = eastwardRoute()
    const index = buildRouteIndex(route)
    expect(index.cumDistance[0]).toBe(0)
    expect(index.cumDuration[0]).toBe(0)
    expect(index.cumDistance.at(-1)).toBeCloseTo(route.totalDistanceM, 6)
    expect(index.cumDuration.at(-1)).toBeCloseTo(route.totalDurationS, 6)
  })
})

describe('projectOntoRoute', () => {
  it('puts a charger sitting exactly on the route at ~zero offset', () => {
    const index = buildRouteIndex(eastwardRoute())
    const onRoute = projectOntoRoute(index, { lat: 48.8, lon: 9.05 })
    expect(onRoute.offsetM).toBeLessThan(1)
  })

  it('reports along-route distance matching the cumulative annotation', () => {
    const route = eastwardRoute()
    const index = buildRouteIndex(route)
    // Vertex 5 is exactly five segments in.
    const expected = route.distances.slice(0, 5).reduce((a, b) => a + b, 0)
    const p = projectOntoRoute(index, { lat: 48.8, lon: 9.05 })
    expect(p.alongDistanceM).toBeCloseTo(expected, 0)
    expect(p.alongDurationS).toBeCloseTo(expected / 25, 0)
  })

  it('interpolates within a segment instead of snapping to a vertex', () => {
    const route = eastwardRoute()
    const index = buildRouteIndex(route)
    // Halfway between vertex 3 and 4.
    const p = projectOntoRoute(index, { lat: 48.8, lon: 9.035 })
    expect(p.segmentIndex).toBe(3)
    expect(p.t).toBeCloseTo(0.5, 2)
    const expected =
      route.distances.slice(0, 3).reduce((a, b) => a + b, 0) + 0.5 * route.distances[3]
    expect(p.alongDistanceM).toBeCloseTo(expected, 0)
  })

  it('measures perpendicular offset for a charger beside the route', () => {
    const index = buildRouteIndex(eastwardRoute())
    // 0.009 degrees of latitude north is almost exactly 1 km.
    const p = projectOntoRoute(index, { lat: 48.809, lon: 9.05 })
    expect(p.offsetM).toBeGreaterThan(950)
    expect(p.offsetM).toBeLessThan(1050)
  })

  it('clamps to the route ends rather than extrapolating past them', () => {
    const index = buildRouteIndex(eastwardRoute())
    const before = projectOntoRoute(index, { lat: 48.8, lon: 8.9 })
    expect(before.alongDistanceM).toBeCloseTo(0, 6)

    const after = projectOntoRoute(index, { lat: 48.8, lon: 9.2 })
    expect(after.alongDistanceM).toBeCloseTo(index.route.totalDistanceM, 0)
  })

  it('handles a degenerate single-vertex route without dividing by zero', () => {
    const route: Route = {
      coordinates: [[9.0, 48.8]],
      distances: [],
      durations: [],
      totalDistanceM: 0,
      totalDurationS: 0,
    }
    const p = projectOntoRoute(buildRouteIndex(route), { lat: 48.81, lon: 9.0 })
    expect(Number.isFinite(p.offsetM)).toBe(true)
    expect(p.alongDistanceM).toBe(0)
  })

  it('handles duplicate consecutive coordinates', () => {
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
    const p = projectOntoRoute(buildRouteIndex(route), { lat: 48.8, lon: 9.005 })
    expect(Number.isFinite(p.alongDistanceM)).toBe(true)
    expect(p.offsetM).toBeLessThan(5)
  })
})

describe('placeChargersOnRoute', () => {
  it('drops chargers beyond the corridor and orders the rest by arrival', () => {
    const index = buildRouteIndex(eastwardRoute())
    const result = placeChargersOnRoute(
      index,
      [
        charger('far', 48.8, 9.08),
        charger('near', 48.8, 9.02),
        charger('way-off', 49.5, 9.05), // ~78 km north
      ],
      { maxOffsetM: 5_000 },
    )
    expect(result.map((r) => r.charger.id)).toEqual(['near', 'far'])
  })

  it('leaves detour unpriced until the matrix step runs', () => {
    const index = buildRouteIndex(eastwardRoute())
    const [first] = placeChargersOnRoute(index, [charger('a', 48.8, 9.02)])
    expect(first.detourS).toBeNull()
  })
})

describe('sampleRoute', () => {
  it('always includes both endpoints', () => {
    const route = eastwardRoute()
    const samples = sampleRoute(route, 4_000)
    expect(samples[0]).toEqual({ lat: 48.8, lon: 9.0 })
    expect(samples.at(-1)).toEqual({ lat: 48.8, lon: 9.1 })
  })

  it('spaces samples at roughly the requested interval', () => {
    const route = eastwardRoute(101, 0.01) // ~73 km
    const samples = sampleRoute(route, 4_000)
    for (let i = 1; i < samples.length - 1; i++) {
      const d = haversineM(samples[i - 1], samples[i])
      expect(d).toBeGreaterThan(3_000)
      expect(d).toBeLessThan(5_500)
    }
  })
})

describe('tilesForRoute', () => {
  it('covers the whole route with no gap wider than the tile span', () => {
    const route = eastwardRoute(101, 0.01)
    const tiles = tilesForRoute(route, { sampleSpacingM: 4_000, tileSpanLatDeg: 0.06 })
    expect(tiles.length).toBeGreaterThan(1)

    // Every route vertex must fall inside at least one tile.
    for (const [lon, lat] of route.coordinates) {
      const covered = tiles.some(
        (t) => lat >= t.fromLat && lat <= t.toLat && lon >= t.fromLon && lon <= t.toLon,
      )
      expect(covered).toBe(true)
    }
  })

  it('produces well-formed boxes with from < to', () => {
    const tiles = tilesForRoute(eastwardRoute(), {})
    for (const t of tiles) {
      expect(t.fromLat).toBeLessThan(t.toLat)
      expect(t.fromLon).toBeLessThan(t.toLon)
    }
  })

  it('keeps tiles roughly square by widening longitude for latitude', () => {
    const [tile] = tilesForRoute(eastwardRoute(2), { tileSpanLatDeg: 0.06 })
    const lonSpan = tile.toLon - tile.fromLon
    // At 48.8 degrees, 1/cos(lat) is about 1.52.
    expect(lonSpan / 0.06).toBeCloseTo(1 / Math.cos((48.8 * Math.PI) / 180), 1)
  })

  it('thins samples instead of truncating when the route exceeds the tile cap', () => {
    const route = eastwardRoute(2001, 0.01) // ~1460 km
    const tiles = tilesForRoute(route, { sampleSpacingM: 4_000, maxTiles: 20 })
    expect(tiles.length).toBeLessThanOrEqual(20)
    // The far end of the route must still be represented, not dropped.
    const lastLon = route.coordinates.at(-1)![0]
    const reachesEnd = tiles.some((t) => t.toLon >= lastLon - 0.5)
    expect(reachesEnd).toBe(true)
  })

  it('never exceeds maxTiles, even at a cap of 1', () => {
    const route = eastwardRoute(2001, 0.01)
    for (const maxTiles of [1, 2, 3, 7, 20]) {
      const tiles = tilesForRoute(route, { sampleSpacingM: 4_000, maxTiles })
      expect(tiles.length).toBeLessThanOrEqual(maxTiles)
      expect(tiles.length).toBeGreaterThan(0)
    }
  })

  it('returns nothing for an empty route', () => {
    expect(
      tilesForRoute({
        coordinates: [],
        distances: [],
        durations: [],
        totalDistanceM: 0,
        totalDurationS: 0,
      }),
    ).toEqual([])
  })
})
