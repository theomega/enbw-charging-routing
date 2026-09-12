import { describe, expect, it } from 'vitest'
import type { Charger, ChargerOnRoute } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { DOT_COLOUR } from './availability'
import { chargerFeatures, framingKey, routeFeatures } from './mapFeatures'
import { SELECTED_STROKE } from './routeColours'

const option = (id: string, coordinates: [number, number][]): RouteOption => {
  const distances = Array(Math.max(0, coordinates.length - 1)).fill(1_000)
  return {
    id,
    summary: `A${id}`,
    route: {
      coordinates,
      distances,
      durations: distances.map(() => 40),
      totalDistanceM: distances.length * 1_000,
      totalDurationS: distances.length * 40,
    },
  }
}

const BRENNER = option('brenner', [
  [11.5, 48.1],
  [11.4, 47.0],
  [11.2, 46.7],
])
const JAUFEN = option('jaufen', [
  [11.5, 48.1],
  [11.0, 47.0],
  [11.2, 46.7],
])

const onRoute = (availablePoints: number | null, lon = 11.4): ChargerOnRoute => ({
  charger: {
    id: `enbw:${lon}`,
    providerId: 'enbw',
    name: 'EnBW Test',
    address: null,
    lat: 47,
    lon,
    totalPoints: 4,
    availablePoints,
    unknownPoints: 0,
    maxPowerKw: 150,
    operator: 'EnBW',
    operatorCode: null,
    priceGroup: null,
    alwaysOpen: true,
    chargePoints: null,
    notes: null,
  } satisfies Charger,
  alongDistanceM: 1_000,
  alongDurationS: 40,
  offsetM: 100,
  routePoint: { lat: 47, lon },
  detourS: 120,
  detourM: 3_000,
  legs: null,
})

describe('routeFeatures', () => {
  it('carries the geometry through untouched', () => {
    const [feature] = routeFeatures([BRENNER], 'brenner').features
    // No simplification, no budget: the map draws the road Mapbox returned.
    expect(feature.geometry.coordinates).toEqual(BRENNER.route.coordinates)
  })

  it('flags exactly one route as selected, and colours it emerald', () => {
    const { features } = routeFeatures([BRENNER, JAUFEN], 'jaufen')
    expect(features.map((f) => f.properties!.selected)).toEqual([false, true])
    expect(features[1].properties!.colour).toBe(SELECTED_STROKE)
    expect(features[0].properties!.colour).not.toBe(SELECTED_STROKE)
  })

  it('carries the route id, which is what a tap on the line reports back', () => {
    const { features } = routeFeatures([BRENNER, JAUFEN], 'brenner')
    expect(features.map((f) => f.properties!.id)).toEqual(['brenner', 'jaufen'])
  })

  it('selects nothing rather than guessing when no route is chosen', () => {
    const { features } = routeFeatures([BRENNER, JAUFEN], null)
    expect(features.every((f) => f.properties!.selected === false)).toBe(true)
    expect(features.every((f) => f.properties!.colour !== SELECTED_STROKE)).toBe(true)
  })

  it('handles an empty route list without inventing a feature', () => {
    expect(routeFeatures([], null).features).toHaveLength(0)
  })
})

describe('chargerFeatures', () => {
  it('places dots at the charger, in lon/lat order', () => {
    const [feature] = chargerFeatures([onRoute(2, 11.42)]).features
    expect(feature.geometry.coordinates).toEqual([11.42, 47])
  })

  it('keeps "no live data" visually distinct from "none free"', () => {
    const colours = chargerFeatures([
      onRoute(2),
      onRoute(1),
      onRoute(0),
      onRoute(null),
    ]).features.map((f) => f.properties!.colour)
    expect(colours).toEqual([DOT_COLOUR.free, DOT_COLOUR.low, DOT_COLOUR.none, DOT_COLOUR.unknown])
  })

  it('carries the charger id, so a tap on a dot can name its row', () => {
    const [feature] = chargerFeatures([onRoute(2, 11.4)]).features
    expect(feature.properties!.id).toBe('enbw:11.4')
  })
})

describe('framingKey', () => {
  it('is unchanged when only the selection changes', () => {
    expect(framingKey([BRENNER, JAUFEN])).toBe(framingKey([BRENNER, JAUFEN]))
  })

  it('changes when the trip does, so the new routes get framed', () => {
    expect(framingKey([BRENNER, JAUFEN])).not.toBe(framingKey([BRENNER]))
  })
})
