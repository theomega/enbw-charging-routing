import { describe, expect, it, vi } from 'vitest'
import {
  CHARGERS_PER_CHUNK,
  DetourCache,
  MATRIX_MAX_COORDS,
  buildChunkQueries,
  chunkCandidates,
  detourCost,
  priceDetours,
  type DetourStop,
  type MatrixQuery,
  type Pricing,
} from './detour'

import type { Charger, ChargerOnRoute } from './types'

const origin = { lat: 48.78, lon: 9.18 } // Stuttgart
const destination = { lat: 48.4, lon: 9.99 } // Ulm

function candidate(id: string, lat: number, lon: number, alongM: number): ChargerOnRoute {
  const charger: Charger = {
    id,
    providerId: 'enbw',
    name: id,
    address: null,
    lat,
    lon,
    availablePoints: 3,
    unknownPoints: 0,
    maxPowerKw: 300,
    operator: 'EnBW',
    operatorCode: 'DEEBW',
    priceGroup: 'ENBW_GROUP',
    alwaysOpen: true,
    chargePoints: null,
    pointPowers: null,
    notes: null,
  }
  return {
    charger,
    alongDistanceM: alongM,
    alongDurationS: alongM / 25,
    offsetM: 200,
    // Due west of the charger, standing in for the road it sits beside.
    routePoint: { lat, lon: lon - 0.002 },
    detourS: null,
    detourM: null,
    legs: null,
  }
}

/** A chunk entry as `buildChunkQueries` wants it. */
const stop = (lat: number, lon: number): DetourStop => ({
  charger: { lat, lon },
  routePoint: { lat, lon: lon - 0.002 },
})

describe('detourCost', () => {
  // Every pair is (to the charger, to the route point beside it), so the answer
  // is what the excursion adds over simply driving past.
  it('adds up the two margins over driving past', () => {
    expect(detourCost(59 * 60, 6 * 60, 56 * 60, 6 * 60)).toBe(3 * 60)
  })

  it('is zero for a charger sitting on the route', () => {
    expect(detourCost(3000, 720, 3000, 720)).toBe(0)
  })

  it('clamps a slightly negative detour to zero', () => {
    // The route point is an arbitrary spot on the carriageway, and Mapbox snaps
    // it to the network like any other coordinate — occasionally somewhere
    // marginally more awkward than the charger's own driveway.
    expect(detourCost(3000, 700, 3020, 700)).toBe(0)
  })

  it('returns null unless all four journeys are routable', () => {
    expect(detourCost(null, 600, 2900, 580)).toBeNull()
    expect(detourCost(3000, null, 2900, 580)).toBeNull()
    expect(detourCost(3000, 600, null, 580)).toBeNull()
    expect(detourCost(3000, 600, 2900, null)).toBeNull()
    expect(detourCost(undefined, 600, 2900, 580)).toBeNull()
  })

  it('works the same in metres', () => {
    expect(detourCost(60_000, 25_000, 57_000, 23_000)).toBe(5_000)
    // Mapbox can answer durations while refusing the distance annotation.
    expect(detourCost(60_000, 25_000, null, 23_000)).toBeNull()
  })

  it('ignores how long the rest of the journey is', () => {
    // The same five-minute excursion, once on a short trip and once on a long
    // one. Nothing outside the two brackets can move the answer — which is why
    // the selected alternative no longer changes a shared stretch's detour.
    expect(detourCost(7_580, 18_099, 7_400, 17_979)).toBe(300)
    expect(detourCost(7_580, 28_099, 7_400, 27_979)).toBe(300)
  })

  it('does not charge a charger for the road it sits on', () => {
    // Driving the Jaufenpass: the charger is on the pass, so its route point is
    // on the pass too and the pass costs nothing extra here. This is what the
    // old whole-route penalty constant was trying to approximate.
    const toCharger = 12 * 3600 + 40 * 60
    const fromCharger = 12 * 60
    expect(detourCost(toCharger, fromCharger, toCharger, fromCharger)).toBe(0)
  })
})

describe('chunkCandidates', () => {
  it('reserves a slot for each charger, its route point, and the endpoint', () => {
    // 25 is the documented Mapbox cap on the driving profile.
    expect(MATRIX_MAX_COORDS).toBe(25)
    expect(CHARGERS_PER_CHUNK).toBe(12)
    expect(2 * CHARGERS_PER_CHUNK + 1).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
  })

  it('splits into full chunks plus a remainder', () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    const chunks = chunkCandidates(items)
    expect(chunks.map((c) => c.length)).toEqual([12, 12, 12, 12, 2])
    expect(chunks.flat()).toEqual(items)
  })

  it('returns nothing for an empty list', () => {
    expect(chunkCandidates([])).toEqual([])
  })
})

describe('buildChunkQueries', () => {
  it('never exceeds the matrix coordinate limit at a full chunk', () => {
    const stops = Array.from({ length: CHARGERS_PER_CHUNK }, (_, i) => stop(48.5 + i / 1000, 9.5))
    const { fromOrigin, toDestination } = buildChunkQueries(origin, destination, stops)
    expect(fromOrigin.coordinates.length).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
    expect(toDestination.coordinates.length).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
  })

  it('lays chargers and route points out as two parallel runs', () => {
    const stops = [stop(48.6, 9.5), stop(48.5, 9.7)]
    const { fromOrigin } = buildChunkQueries(origin, destination, stops)
    expect(fromOrigin.coordinates[0]).toEqual(origin)
    expect(fromOrigin.coordinates.slice(1)).toEqual([
      stops[0].charger,
      stops[1].charger,
      stops[0].routePoint,
      stops[1].routePoint,
    ])
    expect(fromOrigin.sources).toEqual([0])
    expect(fromOrigin.destinations).toEqual([1, 2, 3, 4])
  })

  it('runs every point on to the destination in the second request', () => {
    const stops = [stop(48.6, 9.5), stop(48.5, 9.7)]
    const { toDestination } = buildChunkQueries(origin, destination, stops)
    expect(toDestination.coordinates.at(-1)).toEqual(destination)
    expect(toDestination.sources).toEqual([0, 1, 2, 3])
    expect(toDestination.destinations).toEqual([4])
  })

  it('stays above the two-element matrix minimum at a chunk of one', () => {
    // A chunk of one used to build a 1x1 matrix, which Mapbox rejects outright
    // ("minimum number of matrix elements is 2") and which took the whole
    // pricing pass down with it. The route point is always a second coordinate.
    const { fromOrigin, toDestination } = buildChunkQueries(origin, destination, [stop(48.6, 9.5)])
    expect(fromOrigin.sources.length * fromOrigin.destinations.length).toBeGreaterThanOrEqual(2)
    expect(toDestination.sources.length * toDestination.destinations.length).toBeGreaterThanOrEqual(
      2,
    )
  })

  it('rejects an oversized chunk', () => {
    const tooMany = Array.from({ length: CHARGERS_PER_CHUNK + 1 }, () => stop(48.5, 9.5))
    expect(() => buildChunkQueries(origin, destination, tooMany)).toThrow(/exceeds/)
  })

  it('rejects an empty chunk', () => {
    expect(() => buildChunkQueries(origin, destination, [])).toThrow(/at least one/)
  })
})

/** Per-charger legs; the fake matrix lays the route-point columns in behind. */
interface FakeLegs {
  toCharger: number[]
  fromCharger: number[]
  toRoutePoint: number[]
  fromRoutePoint: number[]
}

const isFromOrigin = (q: MatrixQuery) =>
  q.sources.length === 1 && q.sources[0] === 0 && q.destinations.length > 1

describe('priceDetours', () => {
  /** Fake matrix: answers are derived from the query shape, not the network. */
  function fakeMatrix(seconds: FakeLegs, metres?: FakeLegs) {
    const answer = (l: FakeLegs, q: MatrixQuery) =>
      isFromOrigin(q)
        ? [[...l.toCharger, ...l.toRoutePoint]]
        : [...l.fromCharger, ...l.fromRoutePoint].map((v) => [v])
    return vi.fn(async (q: MatrixQuery) => {
      expect(q.coordinates.length).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
      return { durations: answer(seconds, q), distances: metres ? answer(metres, q) : null }
    })
  }

  it('prices each candidate from the two matrix calls', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000), candidate('b', 48.6, 9.6, 40_000)]
    const matrix = fakeMatrix({
      toCharger: [1800, 3000],
      fromCharger: [2000, 800],
      toRoutePoint: [1700, 2900],
      fromRoutePoint: [1950, 700],
    })
    const out = await priceDetours(origin, destination, candidates, { matrix })

    expect(matrix).toHaveBeenCalledTimes(2) // one chunk = two requests
    expect(out[0].detourS).toBe(1800 - 1700 + (2000 - 1950))
    expect(out[1].detourS).toBe(3000 - 2900 + (800 - 700))
  })

  it('measures against the route point rather than the whole journey', async () => {
    // A charger on the road prices at zero however long the trip is, because
    // both of its journeys end where driving past would have put you anyway.
    const candidates = [candidate('on-route', 48.6, 9.6, 30_000)]
    const matrix = fakeMatrix({
      toCharger: [3000],
      fromCharger: [700],
      toRoutePoint: [3000],
      fromRoutePoint: [700],
    })
    const [out] = await priceDetours(origin, destination, candidates, { matrix })
    expect(out.detourS).toBe(0)
  })

  it('prices against the route point each candidate carries', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000)]
    const matrix = fakeMatrix({
      toCharger: [3_000],
      fromCharger: [900],
      toRoutePoint: [2_700],
      fromRoutePoint: [900],
    })
    const [out] = await priceDetours(origin, destination, candidates, { matrix })

    expect(matrix.mock.calls[0][0].coordinates).toContainEqual(candidates[0].routePoint)
    expect(out.detourS).toBe(300)
  })

  it('marks unroutable chargers as unpriced instead of dropping them', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000), candidate('bad', 48.6, 9.6, 20_000)]
    const matrix = vi.fn(async (q: MatrixQuery) => {
      if (isFromOrigin(q)) return { durations: [[1800, null, 1700, 3000]], distances: null }
      return { durations: [[2000], [null], [1900], [3100]], distances: null }
    })
    const out = await priceDetours(origin, destination, candidates, { matrix })
    expect(out).toHaveLength(2)
    expect(out[0].detourS).toBe(200)
    expect(out[1].detourS).toBeNull()
  })

  it('is unpriced when only the route point fails to route', async () => {
    // Half a measurement is not a detour: without the baseline there is nothing
    // to subtract, so the row reads as unpriced rather than as a huge detour.
    const candidates = [candidate('a', 48.7, 9.3, 10_000)]
    const matrix = vi.fn(async (q: MatrixQuery) => {
      if (isFromOrigin(q)) return { durations: [[1800, null]], distances: null }
      return { durations: [[2000], [1900]], distances: null }
    })
    const [out] = await priceDetours(origin, destination, candidates, { matrix })
    expect(out.detourS).toBeNull()
    expect(out.legs?.toChargerS).toBe(1800)
  })

  it('splits into multiple chunks without exceeding the coordinate cap', async () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      candidate(`c${i}`, 48.7 - i / 100, 9.2 + i / 100, i * 1000),
    )
    const matrix = vi.fn(async (q: MatrixQuery) => {
      expect(q.coordinates.length).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
      const k = (q.coordinates.length - 1) / 2
      const row = (charger: number, routePoint: number) => [
        ...Array.from({ length: k }, () => charger),
        ...Array.from({ length: k }, () => routePoint),
      ]
      if (isFromOrigin(q)) return { durations: [row(1800, 1700)], distances: null }
      return { durations: row(2000, 1900).map((v) => [v]), distances: null }
    })
    const out = await priceDetours(origin, destination, candidates, { matrix, limit: 30 })
    expect(matrix).toHaveBeenCalledTimes(6) // 12 + 12 + 6 => three chunks => six requests
    expect(out.every((c) => c.detourS === 200)).toBe(true)
  })

  it('only prices up to the limit, leaving the rest unpriced', async () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      candidate(`c${i}`, 48.7, 9.2 + i / 100, i * 1000),
    )
    const matrix = fakeMatrix({
      toCharger: Array(3).fill(1800),
      fromCharger: Array(3).fill(2000),
      toRoutePoint: Array(3).fill(1700),
      fromRoutePoint: Array(3).fill(1900),
    })
    const out = await priceDetours(origin, destination, candidates, { matrix, limit: 3 })
    expect(matrix).toHaveBeenCalledTimes(2)
    expect(out.slice(0, 3).every((c) => c.detourS === 200)).toBe(true)
    expect(out.slice(3).every((c) => c.detourS === null)).toBe(true)
    expect(out).toHaveLength(10)
  })

  it('keeps the two driving legs, which cost nothing extra to carry', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000)]
    const matrix = fakeMatrix(
      { toCharger: [1800], fromCharger: [2000], toRoutePoint: [1700], fromRoutePoint: [1900] },
      {
        toCharger: [42_000],
        fromCharger: [51_000],
        toRoutePoint: [40_000],
        fromRoutePoint: [50_000],
      },
    )
    const [out] = await priceDetours(origin, destination, candidates, { matrix })

    // The legs stay absolute — they answer "how far to it", not "how far extra".
    expect(out.legs).toEqual({
      toChargerM: 42_000,
      toChargerS: 1800,
      fromChargerM: 51_000,
      fromChargerS: 2000,
    })
    expect(out.detourM).toBe(42_000 - 40_000 + (51_000 - 50_000))
  })

  it('still prices the detour when Mapbox refuses the distance annotation', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000)]
    const matrix = fakeMatrix({
      toCharger: [1800],
      fromCharger: [2000],
      toRoutePoint: [1700],
      fromRoutePoint: [1900],
    })
    const [out] = await priceDetours(origin, destination, candidates, { matrix })

    expect(out.detourS).toBe(200)
    expect(out.detourM).toBeNull()
    expect(out.legs).toEqual({
      toChargerM: null,
      toChargerS: 1800,
      fromChargerM: null,
      fromChargerS: 2000,
    })
  })

  it('leaves rows past the limit with no legs at all', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000), candidate('b', 48.6, 9.6, 40_000)]
    const matrix = fakeMatrix(
      { toCharger: [1800], fromCharger: [2000], toRoutePoint: [1700], fromRoutePoint: [1900] },
      {
        toCharger: [42_000],
        fromCharger: [51_000],
        toRoutePoint: [40_000],
        fromRoutePoint: [50_000],
      },
    )
    const out = await priceDetours(origin, destination, candidates, { matrix, limit: 1 })

    expect(out[0].legs).not.toBeNull()
    expect(out[1].legs).toBeNull()
    expect(out[1].detourM).toBeNull()
  })

  it('makes no requests when there are no candidates', async () => {
    const matrix = vi.fn()
    const out = await priceDetours(origin, destination, [], { matrix })
    expect(matrix).not.toHaveBeenCalled()
    expect(out).toEqual([])
  })
})

describe('DetourCache', () => {
  const pricing = (detourS: number | null): Pricing => ({
    detourS,
    detourM: detourS == null ? null : detourS * 20,
    legs: { toChargerM: 1, toChargerS: 2, fromChargerM: 3, fromChargerS: 4 },
  })

  it('survives GPS jitter below the rounding threshold', () => {
    const cache = new DetourCache()
    cache.set(origin, destination, 'enbw:1', pricing(180))
    const jittered = { lat: origin.lat + 0.0002, lon: origin.lon - 0.0002 }
    expect(cache.get(jittered, destination, 'enbw:1')?.detourS).toBe(180)
  })

  it('misses once the origin has actually moved', () => {
    const cache = new DetourCache()
    cache.set(origin, destination, 'enbw:1', pricing(180))
    expect(cache.has({ lat: origin.lat + 0.05, lon: origin.lon }, destination, 'enbw:1')).toBe(
      false,
    )
  })

  it('caches the legs alongside the detour, so a reopened panel costs nothing', () => {
    const cache = new DetourCache()
    cache.set(origin, destination, 'enbw:1', pricing(180))
    expect(cache.get(origin, destination, 'enbw:1')?.legs).toEqual({
      toChargerM: 1,
      toChargerS: 2,
      fromChargerM: 3,
      fromChargerS: 4,
    })
  })

  it('distinguishes a cached unroutable entry from a missing one', () => {
    const cache = new DetourCache()
    cache.set(origin, destination, 'enbw:1', pricing(null))
    expect(cache.has(origin, destination, 'enbw:1')).toBe(true)
    expect(cache.get(origin, destination, 'enbw:1')?.detourS).toBeNull()
    expect(cache.has(origin, destination, 'enbw:2')).toBe(false)
  })
})
