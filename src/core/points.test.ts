import { describe, expect, it } from 'vitest'
import { matchingPoints } from './points'
import type { ChargePoint, Charger, PointPowerGroup } from './types'

/** A fast hub as EnBW describes one: four 300 kW stalls beside four AC posts. */
const point = (maxPowerKw: number | null, status: string | null): ChargePoint => ({
  id: null,
  plugs: ['CCS (Typ 2)'],
  maxPowerKw,
  status,
})

const charger = (over: Partial<Charger> = {}): Charger => ({
  id: 'enbw:1',
  providerId: 'enbw',
  name: 'Hub',
  address: null,
  lat: 48.8,
  lon: 9.1,
  availablePoints: 4,
  unknownPoints: 0,
  maxPowerKw: 300,
  operator: 'EnBW',
  operatorCode: 'DEEBW',
  priceGroup: 'ENBW_GROUP',
  alwaysOpen: true,
  chargePoints: null,
  pointPowers: null,
  notes: null,
  ...over,
})

const HUB_POINTS: ChargePoint[] = [
  point(300, 'AVAILABLE'),
  point(300, 'OCCUPIED'),
  point(300, 'OCCUPIED'),
  point(300, 'OUT_OF_SERVICE'),
  point(22, 'AVAILABLE'),
  point(22, 'AVAILABLE'),
  point(22, 'AVAILABLE'),
  point(22, 'OCCUPIED'),
]

const HUB_POWERS: PointPowerGroup[] = [
  { maxPowerKw: 300, count: 4 },
  { maxPowerKw: 22, count: 4 },
]

describe('matchingPoints', () => {
  /** The reported bug: "4/8", where three of those four free posts are AC. */
  it('counts only the points the setting leaves, free ones included', () => {
    expect(matchingPoints(charger({ chargePoints: HUB_POINTS }), 50)).toEqual({
      total: 4,
      free: 1,
    })
  })

  it('counts every point once the setting is below all of them', () => {
    expect(matchingPoints(charger({ chargePoints: HUB_POINTS }), 11)).toEqual({
      total: 8,
      free: 4,
    })
  })

  it('keeps a point of unknown power rather than guessing it away', () => {
    const points = [point(300, 'AVAILABLE'), point(null, 'AVAILABLE'), point(22, 'AVAILABLE')]
    expect(matchingPoints(charger({ chargePoints: points }), 150)).toEqual({ total: 2, free: 2 })
  })

  /** "?" and "0 frei" are different statements; see availability.ts. */
  it('reports the free count as unknown when no point carries a state', () => {
    const points = [point(300, null), point(300, null)]
    expect(matchingPoints(charger({ chargePoints: points }), 50)).toEqual({ total: 2, free: null })
  })

  it('takes the denominator from the shipped list before any lookup', () => {
    const shipped = charger({ availablePoints: null, pointPowers: HUB_POWERS })
    // "?/4", where the 4 is already the fast stalls and not the station's size.
    expect(matchingPoints(shipped, 50)).toEqual({ total: 4, free: null })
  })

  /**
   * With nothing excluded the station-level free count *is* the free count of
   * the matching points, so the badge keeps the number it always showed.
   */
  it('keeps the station-level free count when the setting excludes nothing', () => {
    const shipped = charger({ pointPowers: [{ maxPowerKw: 300, count: 4 }] })
    expect(matchingPoints(shipped, 50)).toEqual({ total: 4, free: 4 })
  })

  /**
   * EnBW says how many points are free, never which, so once an AC post is out
   * of the count its state cannot be credited to the fast stalls.
   */
  it('will not attribute the station-level free count once anything is excluded', () => {
    expect(matchingPoints(charger({ pointPowers: HUB_POWERS }), 50)).toEqual({
      total: 4,
      free: null,
    })
  })

  it('prefers the live record to the shipped powers', () => {
    const both = charger({ chargePoints: HUB_POINTS.slice(0, 2), pointPowers: HUB_POWERS })
    expect(matchingPoints(both, 50)).toEqual({ total: 2, free: 1 })
  })

  /**
   * A station whose detail lookup failed during the build and has not answered
   * since. EnBW's own station-level counts are not a fallback: they are the
   * numbers this module exists to stop displaying.
   */
  it('says nothing at all when the row has no per-point data', () => {
    expect(matchingPoints(charger(), 50)).toEqual({ total: null, free: null })
  })

  /**
   * Only reachable when the per-point data contradicts the station's own
   * headline power, which is what put the station in the list to begin with.
   * "0/0" would publish that contradiction as a fact about the station.
   */
  it('reports nothing rather than a station with no matching point', () => {
    expect(matchingPoints(charger({ pointPowers: [{ maxPowerKw: 22, count: 8 }] }), 50)).toEqual({
      total: null,
      free: null,
    })
    expect(matchingPoints(charger({ chargePoints: [point(22, 'AVAILABLE')] }), 50)).toEqual({
      total: null,
      free: null,
    })
  })
})
