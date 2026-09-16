import { describe, expect, it } from 'vitest'
import { eastwardRoute } from '../test/routes'
import {
  OFF_ROUTE_M,
  PASSED_GRACE_M,
  aheadOfDriver,
  isOffRoute,
  remainingRoute,
  routeProgress,
  type RouteProgress,
} from './progress'
import { buildRouteGeometry } from './route'
import type { ChargerOnRoute, LatLon } from './types'

/** The fixture runs due east along 48.8, so distance is a longitude offset. */
const route = eastwardRoute(11, 0.01)
const geometry = buildRouteGeometry(route)

/** Lon of the point `fraction` of the way along the fixture route. */
const lonAt = (fraction: number): number => 9.0 + fraction * 0.1

const progressAt = (fraction: number, lat = 48.8): RouteProgress =>
  routeProgress(geometry, { lat, lon: lonAt(fraction) })

/** A station whose route point is `fraction` along, sitting `offsetM` aside. */
const station = (id: string, fraction: number, at?: LatLon): ChargerOnRoute => {
  const projection = geometry.project({ lat: 48.8, lon: lonAt(fraction) })
  return {
    charger: { id, lat: at?.lat ?? 48.8, lon: at?.lon ?? lonAt(fraction) },
    alongDistanceM: projection.alongDistanceM,
    alongDurationS: projection.alongDurationS,
    offsetM: 0,
    routePoint: projection.point,
    detourS: null,
    detourM: null,
    legs: null,
  } as unknown as ChargerOnRoute
}

describe('routeProgress', () => {
  it('is zero at the route start', () => {
    const p = progressAt(0)
    expect(p.alongDistanceM).toBeCloseTo(0, 0)
    expect(p.alongDurationS).toBeCloseTo(0, 0)
  })

  it('measures how far along the driver is, by the route annotations', () => {
    const p = progressAt(0.5)
    expect(p.alongDistanceM).toBeCloseTo(route.totalDistanceM / 2, -2)
    // The fixture is annotated at a flat 25 m/s.
    expect(p.alongDurationS).toBeCloseTo(p.alongDistanceM / 25, 0)
  })

  it('reports the distance off the line, not just the position on it', () => {
    const onIt = progressAt(0.5)
    expect(onIt.offRouteM).toBeLessThan(1)

    // A tenth of a degree of latitude is roughly 11 km north of the road.
    const aside = progressAt(0.5, 48.9)
    expect(aside.offRouteM).toBeGreaterThan(10_000)
    // Still the same place along the route: it is a perpendicular offset.
    expect(aside.alongDistanceM).toBeCloseTo(onIt.alongDistanceM, -2)
  })
})

describe('isOffRoute', () => {
  it('tolerates a carriageway offset and normal GPS error', () => {
    expect(isOffRoute({ alongDistanceM: 0, alongDurationS: 0, offRouteM: 40 })).toBe(false)
    expect(isOffRoute({ alongDistanceM: 0, alongDurationS: 0, offRouteM: OFF_ROUTE_M })).toBe(false)
  })

  it('fires once the route no longer describes the drive', () => {
    expect(isOffRoute({ alongDistanceM: 0, alongDurationS: 0, offRouteM: OFF_ROUTE_M + 1 })).toBe(
      true,
    )
  })
})

describe('remainingRoute', () => {
  it('is what is left from where the driver is, not the route total', () => {
    const left = remainingRoute(route, progressAt(0.25))
    expect(left.distanceM).toBeCloseTo(route.totalDistanceM * 0.75, -2)
    expect(left.durationS).toBeCloseTo(route.totalDurationS * 0.75, 0)
  })

  it('never goes negative past the destination', () => {
    const past = remainingRoute(route, {
      alongDistanceM: route.totalDistanceM + 5_000,
      alongDurationS: route.totalDurationS + 200,
      offRouteM: 0,
    })
    expect(past.distanceM).toBe(0)
    expect(past.durationS).toBe(0)
  })
})

describe('aheadOfDriver', () => {
  const position = { lat: 48.8, lon: lonAt(0.5) }
  const items = [station('behind', 0.1), station('ahead', 0.75), station('far', 0.9)]

  it('drops the stations already passed', () => {
    const out = aheadOfDriver(items, progressAt(0.5), position)
    expect(out.map((c) => c.charger.id)).toEqual(['ahead', 'far'])
  })

  it('re-measures the survivors from the driver rather than the route start', () => {
    const progress = progressAt(0.5)
    const [next] = aheadOfDriver(items, progress, position)
    const placed = items.find((c) => c.charger.id === 'ahead')!
    expect(next.alongDistanceM).toBeCloseTo(placed.alongDistanceM - progress.alongDistanceM, 6)
    expect(next.alongDurationS).toBeCloseTo(placed.alongDurationS - progress.alongDurationS, 6)
    // A quarter of the route still to go to reach it.
    expect(next.alongDistanceM).toBeCloseTo(route.totalDistanceM * 0.25, -2)
  })

  it('keeps a passed station while the driver is still at it', () => {
    // Parked at the station itself, whose route point is now behind them.
    const charging = station('charging', 0.4)
    const justPast = { lat: 48.8, lon: lonAt(0.45) }
    const out = aheadOfDriver([charging], routeProgress(geometry, justPast), justPast)
    expect(out.map((c) => c.charger.id)).toEqual(['charging'])
  })

  it('drops it once the driver has left it behind', () => {
    const charging = station('charging', 0.4)
    const gone = { lat: 48.8, lon: lonAt(0.9) }
    const out = aheadOfDriver([charging], routeProgress(geometry, gone), gone)
    expect(out).toHaveLength(0)
  })

  it('measures the grace to the station, not to its route point', () => {
    // Route point a long way back, but the charger itself is beside the driver
    // — which is what a motorway services stop looks like.
    const beside = station('beside', 0.1, { lat: 48.8, lon: lonAt(0.5) })
    const out = aheadOfDriver([beside], progressAt(0.5), position)
    expect(out).toHaveLength(1)

    const away = station('away', 0.1)
    expect(aheadOfDriver([away], progressAt(0.5), position)).toHaveLength(0)
    // Sanity: that one really is outside the grace.
    expect(route.totalDistanceM * 0.4).toBeGreaterThan(PASSED_GRACE_M)
  })

  it('clamps a kept passed station at zero rather than reading negative', () => {
    const charging = station('charging', 0.4)
    const justPast = { lat: 48.8, lon: lonAt(0.45) }
    const [out] = aheadOfDriver([charging], routeProgress(geometry, justPast), justPast)
    expect(out.alongDistanceM).toBe(0)
    expect(out.alongDurationS).toBe(0)
  })

  it('preserves route order, which is what makes "the next n" mean anything', () => {
    const out = aheadOfDriver(items, progressAt(0), { lat: 48.8, lon: lonAt(0) })
    expect(out.map((c) => c.charger.id)).toEqual(['behind', 'ahead', 'far'])
    for (let i = 1; i < out.length; i++) {
      expect(out[i].alongDistanceM).toBeGreaterThan(out[i - 1].alongDistanceM)
    }
  })

  it('leaves the input untouched', () => {
    const before = items.map((c) => c.alongDistanceM)
    aheadOfDriver(items, progressAt(0.5), position)
    expect(items.map((c) => c.alongDistanceM)).toEqual(before)
  })
})
