import { describe, expect, it } from 'vitest'
import { applyFilters } from './useRouteSearch'
import { DEFAULT_SETTINGS, type Settings } from '../state/store'
import { buildRouteIndex, placeChargersOnRoute, type Route } from '../routing/corridor'
import type { Charger, ChargerOnRoute } from '../providers/types'

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over })

function charger(over: Partial<Charger> & { id: string }): Charger {
  return {
    providerId: 'enbw',
    name: over.id,
    address: null,
    lat: 48.8,
    lon: 9.1,
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
    ...over,
  }
}

const onRoute = (c: Charger, alongM: number): ChargerOnRoute => ({
  charger: c,
  alongDistanceM: alongM,
  alongDurationS: alongM / 25,
  offsetM: 100,
  detourS: null,
})

describe('applyFilters', () => {
  it('preserves route order', () => {
    // The list is never re-sorted downstream, so order must survive filtering.
    const items = [
      onRoute(charger({ id: 'a' }), 1_000),
      onRoute(charger({ id: 'skip', priceGroup: 'GROUP70' }), 2_000),
      onRoute(charger({ id: 'b' }), 3_000),
      onRoute(charger({ id: 'c' }), 4_000),
    ]
    const out = applyFilters(items, settings())
    expect(out.map((c) => c.charger.id)).toEqual(['a', 'b', 'c'])
    for (let i = 1; i < out.length; i++) {
      expect(out[i].alongDistanceM).toBeGreaterThan(out[i - 1].alongDistanceM)
    }
  })

  it('filters by provider, power and occupancy', () => {
    const items = [
      onRoute(charger({ id: 'roaming', priceGroup: 'GROUP70' }), 1_000),
      onRoute(charger({ id: 'slow', maxPowerKw: 22 }), 2_000),
      onRoute(charger({ id: 'full', availablePoints: 0 }), 3_000),
      onRoute(charger({ id: 'good' }), 4_000),
    ]
    const out = applyFilters(items, settings({ minPowerKw: 50, hideFullStations: true }))
    expect(out.map((c) => c.charger.id)).toEqual(['good'])
  })

  it('keeps chargers of unknown power rather than guessing', () => {
    const items = [onRoute(charger({ id: 'unknown', maxPowerKw: null }), 1_000)]
    expect(applyFilters(items, settings({ minPowerKw: 150 }))).toHaveLength(1)
  })
})

describe('end-to-end ordering invariant', () => {
  it('places, filters and yields chargers in the order you drive past them', () => {
    // Due-east route so along-route distance tracks longitude.
    const coordinates: [number, number][] = Array.from({ length: 21 }, (_, i) => [
      9.0 + i * 0.01,
      48.8,
    ])
    const distances = Array(20).fill(733)
    const route: Route = {
      coordinates,
      distances,
      durations: distances.map((d) => d / 25),
      totalDistanceM: 733 * 20,
      totalDurationS: (733 * 20) / 25,
    }

    // Deliberately supplied out of order.
    const chargers = [
      charger({ id: 'far', lon: 9.18 }),
      charger({ id: 'near', lon: 9.02 }),
      charger({ id: 'mid', lon: 9.1 }),
      charger({ id: 'roaming', lon: 9.05, priceGroup: 'GROUP70' }),
    ]

    const placed = placeChargersOnRoute(buildRouteIndex(route), chargers)
    const out = applyFilters(placed, settings())

    expect(out.map((c) => c.charger.id)).toEqual(['near', 'mid', 'far'])
  })
})
