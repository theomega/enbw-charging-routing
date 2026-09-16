import { describe, expect, it } from 'vitest'
import type { RouteOption } from './directions'
import { buildRefreshUrl, refreshedRoute } from './directionsRefresh'

const option = (): RouteOption => ({
  id: 'abc-0',
  uuid: 'abc',
  routeIndex: 0,
  summary: 'A9, A22',
  route: {
    coordinates: [
      [13.4, 52.5],
      [12.0, 50.0],
      [11.2, 46.7],
    ],
    distances: [100, 200],
    durations: [10, 20],
    totalDistanceM: 300,
    totalDurationS: 30,
  },
})

const legs = (distance: number[], duration: number[]) => ({
  route: { legs: [{ annotation: { distance, duration } }] },
})

describe('buildRefreshUrl', () => {
  it('addresses the route by response uuid, route index and leg index', () => {
    const url = buildRefreshUrl('9d0e-uuid', 2, 'pk.test')
    expect(url).toContain('/directions-refresh/v1/mapbox/driving-traffic/9d0e-uuid/2/0')
    expect(new URL(url).searchParams.get('access_token')).toBe('pk.test')
  })

  it('takes a leg index, though a single destination only ever has one leg', () => {
    expect(buildRefreshUrl('u', 0, 'pk.test', 3)).toContain('/u/0/3')
  })
})

describe('refreshedRoute', () => {
  it('replaces the annotations and re-sums the totals', () => {
    const next = refreshedRoute(option(), legs([110, 190], [30, 60]))
    expect(next?.route.distances).toEqual([110, 190])
    expect(next?.route.durations).toEqual([30, 60])
    expect(next?.route.totalDistanceM).toBe(300)
    // The point of the whole exercise: the ETA moved without re-routing.
    expect(next?.route.totalDurationS).toBe(90)
  })

  it('keeps the id, so caches keyed on it survive a traffic refresh', () => {
    const before = option()
    const next = refreshedRoute(before, legs([110, 190], [30, 60]))
    expect(next?.id).toBe(before.id)
    expect(next?.uuid).toBe(before.uuid)
    expect(next?.routeIndex).toBe(before.routeIndex)
    expect(next?.summary).toBe(before.summary)
  })

  it('is a new object, so the placement re-runs against the new times', () => {
    const before = option()
    const next = refreshedRoute(before, legs([110, 190], [30, 60]))
    expect(next).not.toBe(before)
    expect(next?.route).not.toBe(before.route)
    // Geometry is not refreshed and must come through untouched.
    expect(next?.route.coordinates).toBe(before.route.coordinates)
  })

  it('refuses an answer that does not cover every segment', () => {
    // One leg's worth of a two-segment route: grafting this on would shift
    // every along-route figure by the missing prefix.
    expect(refreshedRoute(option(), legs([110], [30]))).toBeNull()
    expect(refreshedRoute(option(), legs([110, 190, 50], [30, 60, 10]))).toBeNull()
  })

  it('refuses an answer missing either annotation', () => {
    expect(
      refreshedRoute(option(), { route: { legs: [{ annotation: { duration: [1, 2] } }] } }),
    ).toBeNull()
    expect(
      refreshedRoute(option(), { route: { legs: [{ annotation: { distance: [1, 2] } }] } }),
    ).toBeNull()
  })

  it('refuses an answer with no route at all', () => {
    expect(refreshedRoute(option(), {})).toBeNull()
    expect(refreshedRoute(option(), { route: null })).toBeNull()
    expect(refreshedRoute(option(), { route: { legs: null } })).toBeNull()
    expect(refreshedRoute(option(), { code: 'NotFound', message: 'expired' })).toBeNull()
  })

  it('stitches multiple legs together in order', () => {
    const next = refreshedRoute(option(), {
      route: {
        legs: [
          { annotation: { distance: [110], duration: [30] } },
          { annotation: { distance: [190], duration: [60] } },
        ],
      },
    })
    expect(next?.route.distances).toEqual([110, 190])
    expect(next?.route.durations).toEqual([30, 60])
  })
})
