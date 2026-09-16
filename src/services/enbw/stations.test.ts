import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildCorridor, placeChargersOnRoute } from '../../core/corridor'
import { eastwardRouteOfKm } from '../../test/routes'
import {
  MIN_LIST_VERSION,
  MIN_STATION_POWER_KW,
  parseStationList,
  stationLabel,
  unpackStation,
  type PackedStation,
  type StationListFile,
} from './stations'

const fileOf = (stations: PackedStation[]) => ({
  version: 5,
  generatedAt: '2026-09-05T00:00:00.000Z',
  count: stations.length,
  minPowerKw: 50,
  fields: ['stationId', 'lat', 'lon', 'maxPowerKw', 'address', 'operator', 'location', 'points'],
  stations,
})

const VOELS: PackedStation = [
  3029234,
  47.25844,
  11.32309,
  50,
  'Cytastraße 1, 6176 Völs, AT',
  'SMATRICS',
  'MPREIS Völs',
  [[50, 2]],
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
      availablePoints: null,
      unknownPoints: 0,
      maxPowerKw: 50,
      operator: 'SMATRICS',
      operatorCode: null,
      priceGroup: 'ENBW_GROUP',
      // Null, not false or []: the packed row carries none of these, and
      // "unknown" must not render as a positive claim about the station.
      alwaysOpen: null,
      chargePoints: null,
      // The station's size and the only thing it can be filtered by. Null
      // instead — a station whose detail lookup failed during the build — is
      // "the file does not say", which the badge renders as "?" rather than
      // inventing a count.
      pointPowers: [{ maxPowerKw: 50, count: 2 }],
      // The heading, straight out of the file — the reason a row never has to
      // rename itself once a live lookup lands.
      notes: 'MPREIS Völs',
    })
  })

  /**
   * The whole point of carrying identity in the list: this is what a row shows
   * before — and if necessary without — any occupancy lookup.
   */
  it('leaves occupancy unknown while the points are known', () => {
    const charger = unpackStation(VOELS)
    // "?/2", never "0/2", and never "?/0".
    expect(charger.availablePoints).toBeNull()
    expect(charger.pointPowers).toEqual([{ maxPowerKw: 50, count: 2 }])
  })

  /**
   * Version 5's one addition, and the reason the point count can be filtered on
   * a row no lookup has reached: the powers are known from the file.
   */
  it('unpacks the per-point powers, fastest first', () => {
    const charger = unpackStation([
      83242,
      48.25377,
      13.04393,
      300,
      'Raitfeldstraße 7, 5280 Braunau am Inn, AT',
      'SMATRICS',
      'EnBW Braunau',
      [
        [300, 4],
        [22, 4],
      ],
    ])
    expect(charger.pointPowers).toEqual([
      { maxPowerKw: 300, count: 4 },
      { maxPowerKw: 22, count: 4 },
    ])
  })

  it('keeps a point of unknown power as its own group', () => {
    expect(
      unpackStation([
        1,
        48.8,
        9.1,
        150,
        'A 1, DE',
        'EnBW',
        null,
        [
          [150, 2],
          [null, 1],
        ],
      ]).pointPowers,
    ).toEqual([
      { maxPowerKw: 150, count: 2 },
      { maxPowerKw: null, count: 1 },
    ])
  })

  it('carries a null power through rather than inventing a number', () => {
    expect(
      unpackStation([1, 48.8, 9.1, null, 'A 1, 70173 Stuttgart, DE', 'EnBW']).maxPowerKw,
    ).toBeNull()
  })

  /**
   * A station whose detail lookup failed during the build has neither a
   * location line nor any points, and the row still has to render.
   */
  it('falls back to the street label when the row carries no location', () => {
    const charger = unpackStation([
      3029234,
      47.25844,
      11.32309,
      50,
      'Cytastraße 1, 6176 Völs, AT',
      'SMATRICS',
    ])
    expect(charger.notes).toBeNull()
    expect(charger.name).toBe('Cytastraße 1')
    expect(charger.pointPowers).toBeNull()
  })

  it('tolerates a row that is missing its identity columns', () => {
    const charger = unpackStation([1, 48.8, 9.1, 150] as unknown as PackedStation)
    expect(charger.name).toBe('Station 1')
    expect(charger.address).toBeNull()
    expect(charger.pointPowers).toBeNull()
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
      version: 5,
      generatedAt: '2026-09-05T00:00:00.000Z',
      count: 1,
    })
    expect(list.chargers).toHaveLength(1)
  })

  it('enforces the power floor whatever the file claims', () => {
    const list = parseStationList(
      fileOf([
        [1, 48.8, 9.1, 11, 'A 1, DE', 'EnBW'],
        [2, 48.8, 9.2, 49.9, 'B 2, DE', 'EnBW'],
        [3, 48.8, 9.3, 50, 'C 3, DE', 'EnBW'],
        [4, 48.8, 9.4, null, 'D 4, DE', 'EnBW'],
      ]),
    )
    expect(list.chargers.map((c) => c.id)).toEqual(['enbw:3'])
    expect(MIN_STATION_POWER_KW).toBe(50)
  })

  /**
   * Version 5 replaced a column, so an older file does not read as a smaller
   * row — it reads as a wrong one. Refusing it is the only safe answer, and a
   * phone can be serving one out of its HTTP cache.
   */
  it('refuses a file older than the format it reads', () => {
    expect(() => parseStationList({ ...fileOf([VOELS]), version: 4 })).toThrow(
      /version 4.*needs 5/s,
    )
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

/**
 * The committed file itself, which is data rather than code and so is not
 * covered by anything above. It is also the one thing a rebuild can quietly
 * break: the format has no content hash, the app refuses an old version, and a
 * row that lost its points shows "?" to a driver.
 */
describe('the shipped station list', () => {
  it('parses, and every row can state its own size', async () => {
    const file = JSON.parse(
      await readFile(new URL('../../../data/stations.enbw.json', import.meta.url), 'utf8'),
    ) as StationListFile
    const { meta, chargers } = parseStationList(file)

    expect(meta.version).toBeGreaterThanOrEqual(MIN_LIST_VERSION)
    expect(chargers.length).toBeGreaterThan(2_000)

    const withPoints = chargers.filter((c) => c.pointPowers?.length)
    expect(withPoints.length).toBe(chargers.length)

    // Every station is listed for a power one of its own points reaches, which
    // is what makes the displayed count meaningful at every setting.
    for (const c of withPoints) {
      const top = Math.max(...c.pointPowers!.map((g) => g.maxPowerKw ?? 0))
      expect(top).toBe(c.maxPowerKw)
    }
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
