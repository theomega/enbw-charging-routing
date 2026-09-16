import { describe, expect, it } from 'vitest'
import { buildDirectionsUrl, mapDirectionsRoutes, type DirectionsResponse } from './directions'

describe('buildDirectionsUrl', () => {
  const origin = { lat: 52.52, lon: 13.405 }
  const destination = { lat: 46.7, lon: 11.155 }

  it('asks for alternatives, full geometry and per-segment annotations', () => {
    const url = new URL(buildDirectionsUrl(origin, destination, 'pk.test'))
    expect(url.searchParams.get('alternatives')).toBe('true')
    expect(url.searchParams.get('overview')).toBe('full')
    expect(url.searchParams.get('annotations')).toBe('distance,duration')
    expect(url.searchParams.get('geometries')).toBe('geojson')
  })

  it('opts the response into being refreshable later', () => {
    const url = new URL(buildDirectionsUrl(origin, destination, 'pk.test'))
    expect(url.searchParams.get('enable_refresh')).toBe('true')
  })

  it('uses the traffic profile and lon,lat ordering', () => {
    const url = buildDirectionsUrl(origin, destination, 'pk.test')
    expect(url).toContain('/mapbox/driving-traffic/')
    expect(decodeURIComponent(url)).toContain('13.405,52.52;11.155,46.7')
  })
})

describe('mapDirectionsRoutes', () => {
  const leg = (summary: string) => ({
    summary,
    annotation: { distance: [100, 200], duration: [4, 8] },
  })
  const route = (distance: number, duration: number, summary: string) => ({
    distance,
    duration,
    geometry: {
      coordinates: [
        [13.4, 52.5],
        [11.2, 46.7],
        [11.15, 46.7],
      ] as [number, number][],
    },
    legs: [leg(summary)],
  })

  it('maps every alternative, not just the first', () => {
    const body: DirectionsResponse = {
      routes: [
        route(1_150_000, 45_000, 'A9, A22'),
        route(1_121_000, 46_320, 'A9, SS44'),
        route(1_168_000, 47_100, 'A13, B180'),
      ],
    }
    const out = mapDirectionsRoutes(body)
    expect(out).toHaveLength(3)
    expect(out.map((r) => r.summary)).toEqual(['A9, A22', 'A9, SS44', 'A13, B180'])
  })

  it('handles a single-route response, which is the common case', () => {
    const out = mapDirectionsRoutes({ routes: [route(73_000, 3_600, 'A8')] })
    expect(out).toHaveLength(1)
    expect(out[0].route.totalDistanceM).toBe(73_000)
    expect(out[0].route.totalDurationS).toBe(3_600)
  })

  it('flattens per-leg annotations into the Route shape', () => {
    const [option] = mapDirectionsRoutes({ routes: [route(300, 12, 'A8')] })
    expect(option.route.distances).toEqual([100, 200])
    expect(option.route.durations).toEqual([4, 8])
    expect(option.route.coordinates).toHaveLength(3)
  })

  it('gives each alternative a distinct stable id', () => {
    const out = mapDirectionsRoutes({
      routes: [route(1_150_000, 45_000, 'A22'), route(1_121_000, 46_320, 'SS44')],
    })
    expect(new Set(out.map((r) => r.id)).size).toBe(2)
    // Same input must produce the same ids, so React keys stay stable.
    const again = mapDirectionsRoutes({
      routes: [route(1_150_000, 45_000, 'A22'), route(1_121_000, 46_320, 'SS44')],
    })
    expect(again.map((r) => r.id)).toEqual(out.map((r) => r.id))
  })

  it('identifies a route by response uuid and index, which survives a refresh', () => {
    const body = {
      uuid: '9d0e',
      routes: [route(1_150_000, 45_000, 'A22'), route(1_121_000, 46_320, 'SS44')],
    }
    const out = mapDirectionsRoutes(body)
    expect(out.map((r) => r.id)).toEqual(['9d0e-0', '9d0e-1'])
    expect(out.map((r) => r.uuid)).toEqual(['9d0e', '9d0e'])
    expect(out.map((r) => r.routeIndex)).toEqual([0, 1])
  })

  it('does not fold the duration into the id, which a traffic refresh changes', () => {
    const [before] = mapDirectionsRoutes({
      uuid: '9d0e',
      routes: [route(1_150_000, 45_000, 'A22')],
    })
    const [after] = mapDirectionsRoutes({ uuid: '9d0e', routes: [route(1_150_000, 61_000, 'A22')] })
    expect(after.id).toBe(before.id)
  })

  it('falls back to a content-derived id when Mapbox returns no uuid', () => {
    const [option] = mapDirectionsRoutes({ routes: [route(73_000, 3_600, 'A8')] })
    expect(option.uuid).toBeNull()
    expect(option.id).toBe('0-73000-3600')
  })

  it('tolerates a missing summary rather than rendering "undefined"', () => {
    const [option] = mapDirectionsRoutes({
      routes: [{ ...route(300, 12, ''), legs: [{ annotation: { distance: [1], duration: [1] } }] }],
    })
    expect(option.summary).toBe('')
  })

  it('throws with the API message when no route exists', () => {
    expect(() => mapDirectionsRoutes({ routes: [], message: 'No route found' })).toThrow(
      /No route found/,
    )
  })
})
