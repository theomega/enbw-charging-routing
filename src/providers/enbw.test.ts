import { describe, expect, it } from 'vitest'
import {
  PROVIDER_FILTERS,
  matchesProviderFilter,
  toCharger,
  widenFilter,
  type EnbwStation,
} from './enbw'

/** Real records captured from the live API. */
const station = (over: Partial<EnbwStation>): EnbwStation => ({
  grouped: false,
  stationId: 1,
  lat: 48.8,
  lon: 9.1,
  shortAddress: 'Teststraße 1, 70000 Stuttgart, DE',
  operator: 'EnBW',
  operatorCode: 'DEEBW',
  priceGroup: 'ENBW_GROUP',
  numberOfChargePoints: 4,
  availableChargePoints: 2,
  unknownStateChargePoints: 0,
  maxPowerInKw: 300,
  plugTypes: ['CCS'],
  plugTypeNames: ['CCS'],
  authenticationMethods: ['MOBILITY_PLUS_CHARGE_CARD'],
  alwaysOpen: true,
  ...over,
})

/** The South Tyrol site that exposed the operatorCode bug. */
const vahrn = station({
  stationId: 1955461,
  lat: 46.760054,
  lon: 11.638077,
  operator: 'SMATRICS EnBW Italia',
  operatorCode: 'ITSMA',
  priceGroup: 'ENBW_GROUP',
  maxPowerInKw: 400,
  numberOfChargePoints: 20,
  availableChargePoints: 19,
  shortAddress: 'Via Forch 5 / Forchstraße 5, 39040 Varna / Vahrn, IT',
})

describe('matchesProviderFilter — enbw', () => {
  it('matches EnBW-operated stations abroad, not just German DEEBW ones', () => {
    // The regression: ITSMA is EnBW's Italian entity and must count as EnBW.
    expect(matchesProviderFilter(toCharger(vahrn), 'enbw')).toBe(true)
    expect(toCharger(vahrn).operatorCode).toBe('ITSMA')
  })

  it('matches the other EnBW entities seen in the wild', () => {
    for (const code of ['DEEBW', 'ATSMA', 'DESMA', 'DEODR', 'ITSMA']) {
      const c = toCharger(station({ operatorCode: code, priceGroup: 'ENBW_GROUP' }))
      expect(matchesProviderFilter(c, 'enbw')).toBe(true)
    }
  })

  it('excludes roaming partners on another price group', () => {
    const roaming = toCharger(
      station({ operator: 'eze.network GmbH', operatorCode: 'DEEZE', priceGroup: 'GROUP70' }),
    )
    expect(matchesProviderFilter(roaming, 'enbw')).toBe(false)
    // ...but they are still usable with the card.
    expect(matchesProviderFilter(roaming, 'card-usable')).toBe(true)
  })
})

describe('matchesProviderFilter — other filters', () => {
  it('card-usable keys off the authentication method', () => {
    const noCard = toCharger(station({ authenticationMethods: ['OTHERS'], priceGroup: 'GROUP20' }))
    expect(matchesProviderFilter(noCard, 'card-usable')).toBe(false)
    expect(matchesProviderFilter(noCard, 'all')).toBe(true)
  })

  it('is a strict widening from enbw to card-usable to all', () => {
    const c = toCharger(vahrn)
    expect(matchesProviderFilter(c, 'enbw')).toBe(true)
    expect(matchesProviderFilter(c, 'card-usable')).toBe(true)
    expect(matchesProviderFilter(c, 'all')).toBe(true)
  })
})

describe('widenFilter', () => {
  it('walks the list and stops at the widest', () => {
    expect(PROVIDER_FILTERS).toEqual(['enbw', 'card-usable', 'all'])
    expect(widenFilter('enbw')).toBe('card-usable')
    expect(widenFilter('card-usable')).toBe('all')
    expect(widenFilter('all')).toBeNull()
  })
})

describe('toCharger', () => {
  it('maps the live wire format onto the neutral model', () => {
    const c = toCharger(vahrn)
    expect(c).toMatchObject({
      id: 'enbw:1955461',
      providerId: 'enbw',
      totalPoints: 20,
      availablePoints: 19,
      maxPowerKw: 400,
      priceGroup: 'ENBW_GROUP',
    })
    expect(c.name).toBe('Via Forch 5 / Forchstraße 5')
  })

  it('keeps missing availability as null, distinct from zero', () => {
    expect(toCharger(station({ availableChargePoints: null })).availablePoints).toBeNull()
    expect(toCharger(station({ availableChargePoints: 0 })).availablePoints).toBe(0)
  })
})
