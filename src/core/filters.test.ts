import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../state/store'
import { eastwardRoute } from '../test/routes'
import { buildCorridor, placeChargersOnRoute } from './corridor'
import { applyLiveFilters, applyStaticFilters } from './filters'
import type { Charger, ChargerOnRoute } from './types'

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
    operator: 'EnBW',
    operatorCode: 'DEEBW',
    priceGroup: 'ENBW_GROUP',
    alwaysOpen: true,
    chargePoints: null,
    notes: null,
    ...over,
  }
}

const onRoute = (c: Charger, alongM: number): ChargerOnRoute => ({
  charger: c,
  alongDistanceM: alongM,
  alongDurationS: alongM / 25,
  offsetM: 100,
  detourS: null,
  detourM: null,
  legs: null,
})

describe('applyStaticFilters', () => {
  it('preserves route order', () => {
    // The list is never re-sorted downstream, so order must survive filtering.
    const items = [
      onRoute(charger({ id: 'a' }), 1_000),
      onRoute(charger({ id: 'skip', maxPowerKw: 11 }), 2_000),
      onRoute(charger({ id: 'b' }), 3_000),
      onRoute(charger({ id: 'c' }), 4_000),
    ]
    const out = applyStaticFilters(items, settings())
    expect(out.map((c) => c.charger.id)).toEqual(['a', 'b', 'c'])
    for (let i = 1; i < out.length; i++) {
      expect(out[i].alongDistanceM).toBeGreaterThan(out[i - 1].alongDistanceM)
    }
  })

  it('filters by power only, since occupancy is not known yet', () => {
    // No provider predicate any more: the shipped list is EnBW-only by
    // construction, so that filtering happens offline in the list builder.
    const items = [
      onRoute(charger({ id: 'slow', maxPowerKw: 22 }), 2_000),
      onRoute(charger({ id: 'good' }), 4_000),
    ]
    const out = applyStaticFilters(items, settings({ minPowerKw: 50 }))
    expect(out.map((c) => c.charger.id)).toEqual(['good'])
  })
})

describe('applyLiveFilters', () => {
  it('keeps a fully occupied station — occupancy is shown, never filtered', () => {
    const items = [
      onRoute(charger({ id: 'full', availablePoints: 0 }), 1_000),
      onRoute(charger({ id: 'free', availablePoints: 2 }), 2_000),
    ]
    expect(applyLiveFilters(items, settings()).map((c) => c.charger.id)).toEqual(['full', 'free'])
  })

  it('caps by detour but keeps unpriced rows', () => {
    const items = [
      { ...onRoute(charger({ id: 'near' }), 1_000), detourS: 120 },
      { ...onRoute(charger({ id: 'far' }), 2_000), detourS: 1_800 },
      { ...onRoute(charger({ id: 'unpriced' }), 3_000), detourS: null },
    ]
    const out = applyLiveFilters(items, settings({ maxDetourMinutes: 10 }))
    expect(out.map((c) => c.charger.id)).toEqual(['near', 'unpriced'])
  })

  it('keeps chargers of unknown power rather than guessing', () => {
    const items = [onRoute(charger({ id: 'unknown', maxPowerKw: null }), 1_000)]
    expect(applyStaticFilters(items, settings({ minPowerKw: 150 }))).toHaveLength(1)
  })
})

describe('end-to-end ordering invariant', () => {
  it('places, filters and yields chargers in the order you drive past them', async () => {
    // Deliberately supplied out of order.
    const chargers = [
      charger({ id: 'far', lon: 9.18 }),
      charger({ id: 'near', lon: 9.02 }),
      charger({ id: 'mid', lon: 9.1 }),
      charger({ id: 'slow', lon: 9.05, maxPowerKw: 11 }),
    ]

    const placed = await placeChargersOnRoute(buildCorridor(eastwardRoute(21)), chargers)
    const out = applyStaticFilters(placed, settings())

    expect(out.map((c) => c.charger.id)).toEqual(['near', 'mid', 'far'])
  })
})
