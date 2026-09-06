import { describe, expect, it } from 'vitest'
import { buildCorridor, placeChargersOnRoute } from '../../core/corridor'
import { eastwardRouteOfKm } from '../../test/routes'
import {
  MIN_STATION_POWER_KW,
  parseStationList,
  stationLabel,
  unpackStation,
  type PackedStation,
} from './stations'

const fileOf = (stations: PackedStation[]) => ({
  version: 3,
  generatedAt: '2026-09-05T00:00:00.000Z',
  count: stations.length,
  minPowerKw: 50,
  fields: ['stationId', 'lat', 'lon', 'maxPowerKw', 'address', 'totalPoints', 'operator'],
  stations,
})

const VOELS: PackedStation = [
  3029234,
  47.25844,
  11.32309,
  50,
  'Cytastraße 1, 6176 Völs, AT',
  2,
  'SMATRICS',
]

describe('unpackStation', () => {
  it('describes the station completely, without any network call', () => {
    expect(unpackStation(VOELS)).toEqual({
      id: 'enbw:3029234',
      providerId: 'enbw',
      name: 'Cytastraße 1',
      address: 'Cytastraße 1, 6176 Völs, AT',
      lat: 47.25844,
      lon: 11.32309,
      totalPoints: 2,
      availablePoints: null,
      unknownPoints: 0,
      maxPowerKw: 50,
      operator: 'SMATRICS',
      operatorCode: null,
      priceGroup: 'ENBW_GROUP',
      authMethods: [],
      alwaysOpen: false,
    })
  })

  /**
   * The whole point of carrying identity in the list: this is what a row shows
   * before — and if necessary without — any occupancy lookup.
   */
  it('leaves occupancy unknown while the point total is known', () => {
    const charger = unpackStation(VOELS)
    // "?/2", never "0/2", and never "?/0".
    expect(charger.availablePoints).toBeNull()
    expect(charger.totalPoints).toBe(2)
  })

  it('carries a null power through rather than inventing a number', () => {
    expect(
      unpackStation([1, 48.8, 9.1, null, 'A 1, 70173 Stuttgart, DE', 2, 'EnBW']).maxPowerKw,
    ).toBeNull()
  })

  it('tolerates a row that is missing its identity columns', () => {
    const charger = unpackStation([1, 48.8, 9.1, 150] as unknown as PackedStation)
    expect(charger.name).toBe('Station 1')
    expect(charger.address).toBeNull()
    expect(charger.totalPoints).toBe(0)
    expect(charger.availablePoints).toBeNull()
  })
})

describe('stationLabel', () => {
  it('uses the street part of the address', () => {
    expect(stationLabel('Cytastraße 1, 6176 Völs, AT', 'SMATRICS', 1)).toBe('Cytastraße 1')
  })

  it('falls back to the operator, then to the bare id', () => {
    expect(stationLabel(null, 'SMATRICS', 42)).toBe('SMATRICS')
    expect(stationLabel(null, null, 42)).toBe('Station 42')
    expect(stationLabel('  ', '', 42)).toBe('Station 42')
  })
})

describe('parseStationList', () => {
  it('keeps the stamp so a refreshed list is identifiable', () => {
    const list = parseStationList(fileOf([VOELS]))
    expect(list.meta).toEqual({
      version: 3,
      generatedAt: '2026-09-05T00:00:00.000Z',
      count: 1,
    })
    expect(list.chargers).toHaveLength(1)
  })

  it('enforces the power floor whatever the file claims', () => {
    const list = parseStationList(
      fileOf([
        [1, 48.8, 9.1, 11, 'A 1, DE', 2, 'EnBW'],
        [2, 48.8, 9.2, 49.9, 'B 2, DE', 2, 'EnBW'],
        [3, 48.8, 9.3, 50, 'C 3, DE', 2, 'EnBW'],
        [4, 48.8, 9.4, null, 'D 4, DE', 2, 'EnBW'],
      ]),
    )
    expect(list.chargers.map((c) => c.id)).toEqual(['enbw:3'])
    expect(MIN_STATION_POWER_KW).toBe(50)
  })

  it('rejects a malformed file rather than rendering an empty list', () => {
    expect(() => parseStationList({ ...fileOf([]), stations: undefined as never })).toThrow(
      /malformed/,
    )
  })

  it('handles an empty list', () => {
    expect(parseStationList(fileOf([])).chargers).toEqual([])
  })
})

describe('the whole list against a long route', () => {
  /**
   * The shipped list is thousands of stations and the corridor measures every
   * one of them. This is the check that the cost stays sane — the app pays it
   * behind a progress bar, but it must not run away.
   */
  it('places 10,000 stations on a 400 km route in reasonable time', async () => {
    const chargers = Array.from({ length: 10_000 }, (_, i) =>
      unpackStation([
        i + 1,
        46 + (i % 90) * 0.1,
        6 + Math.floor(i / 90) * 0.1,
        150,
        `Street ${i}, 70173 Stuttgart, DE`,
        4,
        'EnBW',
      ]),
    )
    const corridor = buildCorridor(eastwardRouteOfKm(400), 5_000)

    const started = performance.now()
    const placed = await placeChargersOnRoute(corridor, chargers)
    const elapsed = performance.now() - started

    expect(placed.length).toBeLessThan(chargers.length)
    expect(elapsed).toBeLessThan(10_000)
    const along = placed.map((p) => p.alongDistanceM)
    expect([...along].sort((a, b) => a - b)).toEqual(along)
  })
})
