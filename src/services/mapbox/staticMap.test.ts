import polyline from '@mapbox/polyline'
import { describe, expect, it } from 'vitest'
import type { Route } from '../../core/route'
import {
  ALTERNATIVE_STROKES,
  SELECTED_STROKE,
  URL_CHARACTER_BUDGET,
  staticMapUrl,
  strokeColours,
} from './staticMap'

const TOKEN = 'pk.test-token'

function routeFrom(coordinates: [number, number][]): Route {
  const distances = Array(Math.max(0, coordinates.length - 1)).fill(733)
  return {
    coordinates,
    distances,
    durations: distances.map((d) => d / 25),
    totalDistanceM: distances.reduce((a: number, b: number) => a + b, 0),
    totalDurationS: distances.reduce((a: number, b: number) => a + b, 0) / 25,
  }
}

/** A long, wiggly route — the case that actually threatens the URL budget. */
function longRoute(points: number, offset = 0): Route {
  const coordinates: [number, number][] = []
  for (let i = 0; i < points; i++) {
    coordinates.push([11 + offset + i * 0.001 + Math.sin(i / 7) * 0.004, 48 + i * 0.001])
  }
  return routeFrom(coordinates)
}

/** The one-route case, which most of these assertions are about. */
const only = (route: Route) => [{ route, selected: true }]

/** What the overlay should contain for a path that needed no simplification. */
const encodedOf = (route: Route) =>
  polyline.encode(route.coordinates.map(([lon, lat]) => [lat, lon]))

/**
 * Every overlay in a URL, in the order Mapbox will paint them. Matched rather
 * than split on the separator, because a pin's own coordinates contain a comma.
 */
const overlaysOf = (url: string): string[] =>
  url
    .slice(url.indexOf('/static/') + '/static/'.length, url.indexOf('/auto/'))
    .match(/(?:path|pin)-[^(]*\([^)]*\)/g) ?? []

describe('staticMapUrl', () => {
  it('builds an auto-fitted retina URL with the route as a path overlay', () => {
    const url = staticMapUrl(
      only(
        routeFrom([
          [11, 48],
          [11.5, 48.5],
        ]),
      ),
      { token: TOKEN },
    )!
    expect(url).toContain('api.mapbox.com/styles/v1/mapbox/dark-v11/static/')
    expect(url).toContain('/auto/')
    expect(url).toContain('@2x')
    expect(url).toContain(`access_token=${TOKEN}`)
  })

  it('encodes the path as a precision-5 polyline, lat before lon', () => {
    const route = routeFrom([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ])
    // The published test vector for the encoding algorithm.
    expect(encodedOf(route)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(staticMapUrl(only(route), { token: TOKEN })).toContain(
      encodeURIComponent('_p~iF~ps|U_ulLnnqC_mqNvxq`@'),
    )
  })

  it('stays inside the character budget for a huge geometry', () => {
    // An overview=full geometry for a 1000 km route is far too large raw.
    const url = staticMapUrl(only(longRoute(20_000)), { token: TOKEN })!
    expect(url.length).toBeLessThanOrEqual(URL_CHARACTER_BUDGET)
  })

  it('does not simplify a short route it does not need to', () => {
    const route = longRoute(50)
    expect(staticMapUrl(only(route), { token: TOKEN })).toContain(
      encodeURIComponent(encodedOf(route)),
    )
  })

  it('simplifies only as far as it must, keeping both endpoints', () => {
    const route = longRoute(20_000)
    const url = staticMapUrl(only(route), { token: TOKEN })!
    const encoded = decodeURIComponent(url.split('(')[1].split(')')[0])
    const drawn = polyline.decode(encoded)

    expect(drawn.length).toBeLessThan(route.coordinates.length)
    expect(drawn.length).toBeGreaterThan(2)

    // Endpoints survive any amount of simplification — to encoding precision,
    // which is five decimal places (~1 m).
    const [firstLon, firstLat] = route.coordinates[0]
    const [lastLon, lastLat] = route.coordinates[route.coordinates.length - 1]
    expect(drawn[0][0]).toBeCloseTo(firstLat, 5)
    expect(drawn[0][1]).toBeCloseTo(firstLon, 5)
    expect(drawn.at(-1)![0]).toBeCloseTo(lastLat, 5)
    expect(drawn.at(-1)![1]).toBeCloseTo(lastLon, 5)
  })

  it('distinguishes the selected route by stroke colour', () => {
    const route = routeFrom([
      [11, 48],
      [11.5, 48.5],
    ])
    expect(staticMapUrl([{ route, selected: true }], { token: TOKEN })).toContain(SELECTED_STROKE)
    expect(staticMapUrl([{ route, selected: false }], { token: TOKEN })).toContain(
      ALTERNATIVE_STROKES[0],
    )
  })

  it('falls back to endpoints rather than emitting an oversized URL', () => {
    // A budget too small for any real path forces the last-resort branch.
    const url = staticMapUrl(only(longRoute(5_000)), { token: TOKEN, budget: 200 })!
    expect(url).toContain('api.mapbox.com')
    expect(polyline.decode(decodeURIComponent(url.split('(')[1].split(')')[0]))).toHaveLength(2)
  })

  it('returns null without a token so the caller can degrade to text', () => {
    expect(staticMapUrl(only(longRoute(10)), { token: '' })).toBeNull()
  })

  it('returns null for a degenerate single-point route', () => {
    expect(staticMapUrl(only(routeFrom([[11, 48]])), { token: TOKEN })).toBeNull()
  })

  describe('with several routes', () => {
    const alternatives = [
      { route: longRoute(40, 0), selected: false },
      { route: longRoute(40, 0.2), selected: true },
      { route: longRoute(40, 0.4), selected: false },
    ]

    it('draws every route in one image', () => {
      const overlays = overlaysOf(staticMapUrl(alternatives, { token: TOKEN })!)
      expect(overlays.filter((o) => o.startsWith('path-'))).toHaveLength(3)
      for (const { route } of alternatives) {
        expect(overlays.join(',')).toContain(encodeURIComponent(encodedOf(route)))
      }
    })

    it('paints the selected route last so it sits on top', () => {
      const overlays = overlaysOf(staticMapUrl(alternatives, { token: TOKEN })!).filter((o) =>
        o.startsWith('path-'),
      )
      expect(overlays.slice(0, -1).every((o) => o.includes(SELECTED_STROKE))).toBe(false)
      expect(overlays.at(-1)).toContain(`+${SELECTED_STROKE}-`)
      expect(overlays.at(-1)).toContain(encodeURIComponent(encodedOf(alternatives[1].route)))
    })

    it('gives each alternative its own colour, so a legend can name them', () => {
      const overlays = overlaysOf(staticMapUrl(alternatives, { token: TOKEN })!).filter((o) =>
        o.startsWith('path-'),
      )
      const [first, second] = overlays.slice(0, 2)
      expect(first).toContain(`+${ALTERNATIVE_STROKES[0]}-`)
      expect(second).toContain(`+${ALTERNATIVE_STROKES[1]}-`)
    })

    it('draws the selected route thicker than the alternatives', () => {
      const overlays = overlaysOf(staticMapUrl(alternatives, { token: TOKEN })!).filter((o) =>
        o.startsWith('path-'),
      )
      const weight = (o: string) => Number(o.slice('path-'.length, o.indexOf('+')))
      expect(weight(overlays.at(-1)!)).toBeGreaterThan(weight(overlays[0]))
    })

    it('keeps the alternatives in the order Mapbox ranked them', () => {
      const overlays = overlaysOf(staticMapUrl(alternatives, { token: TOKEN })!)
      const first = overlays.indexOf(
        overlays.find((o) => o.includes(encodeURIComponent(encodedOf(alternatives[0].route))))!,
      )
      const third = overlays.indexOf(
        overlays.find((o) => o.includes(encodeURIComponent(encodedOf(alternatives[2].route))))!,
      )
      expect(first).toBeLessThan(third)
    })

    it('holds three huge routes inside the one shared budget', () => {
      const url = staticMapUrl(
        [
          { route: longRoute(20_000, 0), selected: true },
          { route: longRoute(20_000, 0.2), selected: false },
          { route: longRoute(20_000, 0.4), selected: false },
        ],
        { token: TOKEN },
      )!
      expect(url.length).toBeLessThanOrEqual(URL_CHARACTER_BUDGET)
      expect(overlaysOf(url).filter((o) => o.startsWith('path-'))).toHaveLength(3)
    })

    it('skips a degenerate alternative rather than blanking the map', () => {
      const overlays = overlaysOf(
        staticMapUrl(
          [
            { route: longRoute(40), selected: true },
            { route: routeFrom([[11, 48]]), selected: false },
          ],
          { token: TOKEN },
        )!,
      )
      expect(overlays.filter((o) => o.startsWith('path-'))).toHaveLength(1)
    })
  })

  describe('strokeColours', () => {
    it('agrees with the colours the image is drawn with', () => {
      const layers = [
        { route: longRoute(20, 0), selected: false },
        { route: longRoute(20, 0.2), selected: true },
        { route: longRoute(20, 0.4), selected: false },
      ]
      const colours = strokeColours(layers)
      const url = staticMapUrl(layers, { token: TOKEN })!

      expect(colours).toEqual([ALTERNATIVE_STROKES[0], SELECTED_STROKE, ALTERNATIVE_STROKES[1]])
      // The legend's promise: this route's swatch is that line's colour.
      for (const [i, layer] of layers.entries()) {
        const overlay = overlaysOf(url).find((o) =>
          o.includes(encodeURIComponent(encodedOf(layer.route))),
        )!
        expect(overlay).toContain(`+${colours[i]}-`)
      }
    })

    it('cycles rather than running out on an unexpected fourth route', () => {
      const colours = strokeColours([
        { selected: true },
        { selected: false },
        { selected: false },
        { selected: false },
      ])
      expect(colours).toEqual([
        SELECTED_STROKE,
        ALTERNATIVE_STROKES[0],
        ALTERNATIVE_STROKES[1],
        ALTERNATIVE_STROKES[0],
      ])
    })
  })

  describe('endpoint pins', () => {
    const route = routeFrom([
      [11, 48],
      [11.4, 48.2],
      [11.5, 48.5],
    ])

    it('marks start and destination when asked', () => {
      const url = staticMapUrl(only(route), { token: TOKEN, pins: true })!
      expect(url).toContain('pin-s-a+ffffff(11.00000,48.00000)')
      expect(url).toContain(`pin-s-b+${SELECTED_STROKE}(11.50000,48.50000)`)
    })

    it('draws the pins after the paths, so a line cannot cover them', () => {
      const overlays = overlaysOf(staticMapUrl(only(route), { token: TOKEN, pins: true })!)
      expect(overlays.slice(-2).every((o) => o.startsWith('pin-'))).toBe(true)
    })

    it('takes the pins from the selected route, not an alternative', () => {
      const other = routeFrom([
        [1, 2],
        [3, 4],
      ])
      const url = staticMapUrl(
        [
          { route: other, selected: false },
          { route, selected: true },
        ],
        { token: TOKEN, pins: true },
      )!
      expect(url).toContain('pin-s-a+ffffff(11.00000,48.00000)')
      expect(url).not.toContain('(1.00000,2.00000)')
    })

    it('leaves them off by default', () => {
      expect(staticMapUrl(only(route), { token: TOKEN })).not.toContain('pin-')
    })

    it('counts the pins against the budget', () => {
      const url = staticMapUrl(only(longRoute(20_000)), { token: TOKEN, pins: true })!
      expect(url.length).toBeLessThanOrEqual(URL_CHARACTER_BUDGET)
      expect(url).toContain('pin-s-a+')
    })
  })
})
