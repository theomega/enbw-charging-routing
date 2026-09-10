import { describe, expect, it, vi } from 'vitest'
import {
  CHARGERS_PER_CHUNK,
  DetourCache,
  buildChunkQueries,
  chunkCandidates,
  detourMetres,
  detourSeconds,
  priceDetours,
  routePenaltySeconds,
  MATRIX_MAX_COORDS,
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
    totalPoints: 6,
    availablePoints: 3,
    unknownPoints: 0,
    maxPowerKw: 300,
    operator: 'EnBW',
    operatorCode: 'DEEBW',
    priceGroup: 'ENBW_GROUP',
    alwaysOpen: true,
    chargePoints: null,
    notes: null,
  }
  return {
    charger,
    alongDistanceM: alongM,
    alongDurationS: alongM / 25,
    offsetM: 200,
    detourS: null,
    detourM: null,
    legs: null,
  }
}

describe('detourSeconds', () => {
  it('computes the extra driving time', () => {
    // The worked example from the plan: Stuttgart -> Ulm via Seligweiler.
    expect(detourSeconds(59 * 60, 6 * 60, 62 * 60)).toBe(3 * 60)
  })

  it('is ~zero for a charger sitting on the route', () => {
    expect(detourSeconds(3000, 720, 3720)).toBe(0)
  })

  it('clamps a slightly negative detour to zero', () => {
    expect(detourSeconds(3000, 700, 3720)).toBe(0)
  })

  it('returns null when either leg is unroutable', () => {
    expect(detourSeconds(null, 600, 3720)).toBeNull()
    expect(detourSeconds(3000, null, 3720)).toBeNull()
    expect(detourSeconds(3000, 600, null)).toBeNull()
    expect(detourSeconds(undefined, 600, 3720)).toBeNull()
  })
})

describe('detourMetres', () => {
  it('computes the extra road distance', () => {
    expect(detourMetres(60_000, 25_000, 80_000)).toBe(5_000)
  })

  it('clamps to zero for a charger sitting on the route', () => {
    expect(detourMetres(60_000, 20_100, 80_200)).toBe(0)
  })

  it('returns null when any leg is unmeasured', () => {
    expect(detourMetres(null, 20_000, 80_000)).toBeNull()
    expect(detourMetres(60_000, null, 80_000)).toBeNull()
    // Mapbox can answer durations while refusing the distance annotation.
    expect(detourMetres(60_000, 20_000, null)).toBeNull()
  })

  it('takes no route penalty', () => {
    // A longer alternative really is longer for every charger on it, so unlike
    // the duration there is nothing to re-baseline away.
    expect(detourMetres.length).toBe(3)
  })
})

describe('route penalty re-baselining', () => {
  it('is zero when the fastest route is selected', () => {
    expect(routePenaltySeconds(45_000, 45_000)).toBe(0)
  })

  it('is the gap to the fastest route when a slower one is selected', () => {
    // Jaufenpass at 12 h 52 against the A22 at 12 h 30.
    expect(routePenaltySeconds(12 * 3600 + 52 * 60, 12 * 3600 + 30 * 60)).toBe(22 * 60)
  })

  it('never goes negative if the selected route somehow prices faster', () => {
    expect(routePenaltySeconds(44_000, 45_000)).toBe(0)
  })

  it('leaves detours untouched at zero penalty', () => {
    expect(detourSeconds(3_540, 360, 3_720, 0)).toBe(detourSeconds(3_540, 360, 3_720))
  })

  it('zeroes out a charger sitting on the selected slower alternative', () => {
    // Driving the Jaufenpass: reaching this charger costs the route's own
    // 22 min penalty and nothing more, so the detour is zero, not +22 min.
    const t1 = 12 * 3600 + 40 * 60
    const t2 = 12 * 60
    const tDirect = 12 * 3600 + 30 * 60
    expect(detourSeconds(t1, t2, tDirect)).toBe(22 * 60)
    expect(detourSeconds(t1, t2, tDirect, 22 * 60)).toBe(0)
  })

  it('still reports a genuine detour on top of the route penalty', () => {
    // 22 min route penalty plus a real 8 min excursion off it.
    const t1 = 12 * 3600 + 48 * 60
    const t2 = 12 * 60
    const tDirect = 12 * 3600 + 30 * 60
    expect(detourSeconds(t1, t2, tDirect, 22 * 60)).toBe(8 * 60)
  })

  it('never goes negative once the penalty is applied', () => {
    expect(detourSeconds(3_000, 600, 3_600, 600)).toBe(0)
  })
})

describe('chunkCandidates', () => {
  it('reserves two coordinate slots for origin and destination', () => {
    // 25 is the documented Mapbox cap on the driving profile.
    expect(MATRIX_MAX_COORDS).toBe(25)
    expect(CHARGERS_PER_CHUNK).toBe(23)
    expect(CHARGERS_PER_CHUNK + 2).toBe(MATRIX_MAX_COORDS)
  })

  it('splits into full chunks plus a remainder', () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    const chunks = chunkCandidates(items)
    expect(chunks.map((c) => c.length)).toEqual([23, 23, 4])
    expect(chunks.flat()).toEqual(items)
  })

  it('returns nothing for an empty list', () => {
    expect(chunkCandidates([])).toEqual([])
  })
})

describe('buildChunkQueries', () => {
  it('never exceeds the matrix coordinate limit at a full chunk', () => {
    const chargers = Array.from({ length: CHARGERS_PER_CHUNK }, (_, i) => ({
      lat: 48.5 + i / 1000,
      lon: 9.5,
    }))
    const { fromOrigin, toDestination } = buildChunkQueries(origin, destination, chargers)
    expect(fromOrigin.coordinates.length).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
    expect(toDestination.coordinates.length).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
  })

  it('puts the destination last so t_direct arrives in the same request', () => {
    const chargers = [
      { lat: 48.6, lon: 9.5 },
      { lat: 48.5, lon: 9.7 },
    ]
    const { fromOrigin } = buildChunkQueries(origin, destination, chargers)
    expect(fromOrigin.coordinates[0]).toEqual(origin)
    expect(fromOrigin.coordinates.at(-1)).toEqual(destination)
    expect(fromOrigin.sources).toEqual([0])
    // chargers at 1..2, destination at 3
    expect(fromOrigin.destinations).toEqual([1, 2, 3])
  })

  it('asks for charger -> destination in the second request', () => {
    const chargers = [
      { lat: 48.6, lon: 9.5 },
      { lat: 48.5, lon: 9.7 },
    ]
    const { toDestination } = buildChunkQueries(origin, destination, chargers)
    expect(toDestination.coordinates.at(-1)).toEqual(destination)
    expect(toDestination.sources).toEqual([0, 1])
    expect(toDestination.destinations).toEqual([2])
  })

  it('rejects an oversized chunk', () => {
    const tooMany = Array.from({ length: CHARGERS_PER_CHUNK + 1 }, () => ({ lat: 48.5, lon: 9.5 }))
    expect(() => buildChunkQueries(origin, destination, tooMany)).toThrow(/exceeds/)
  })

  it('rejects an empty chunk', () => {
    expect(() => buildChunkQueries(origin, destination, [])).toThrow(/at least one/)
  })
})

describe('priceDetours', () => {
  /** Fake matrix: legs are derived from the query shape, not the network. */
  function fakeMatrix(
    toCharger: number[],
    fromCharger: number[],
    tDirect: number,
    metres?: { toCharger: number[]; fromCharger: number[]; dDirect: number },
  ) {
    const isFromOrigin = (q: MatrixQuery) =>
      q.sources.length === 1 && q.sources[0] === 0 && q.destinations.length > 1
    return vi.fn(async (q: MatrixQuery) => {
      expect(q.coordinates.length).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
      // fromOrigin: one row, chargers then the destination.
      // toDestination: one row per charger, single column.
      const durations = isFromOrigin(q) ? [[...toCharger, tDirect]] : fromCharger.map((v) => [v])
      if (!metres) return { durations, distances: null }
      const distances = isFromOrigin(q)
        ? [[...metres.toCharger, metres.dDirect]]
        : metres.fromCharger.map((v) => [v])
      return { durations, distances }
    })
  }

  it('prices each candidate from the two matrix calls', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000), candidate('b', 48.6, 9.6, 40_000)]
    const matrix = fakeMatrix([1800, 3000], [2000, 800], 3600)
    const out = await priceDetours(origin, destination, candidates, { matrix })

    expect(matrix).toHaveBeenCalledTimes(2) // one chunk = two requests
    expect(out[0].detourS).toBe(1800 + 2000 - 3600)
    expect(out[1].detourS).toBe(3000 + 800 - 3600)
  })

  it('reads t_direct from the matrix rather than the traffic route', async () => {
    // If t_direct were taken from a traffic-profile route it would be larger,
    // and this on-route charger would price as a negative (clamped) detour.
    const candidates = [candidate('on-route', 48.6, 9.6, 30_000)]
    const matrix = fakeMatrix([3000], [700], 3700)
    const [out] = await priceDetours(origin, destination, candidates, { matrix })
    expect(out.detourS).toBe(0)
  })

  it('marks unroutable chargers as unpriced instead of dropping them', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000), candidate('bad', 48.6, 9.6, 20_000)]
    const matrix = vi.fn(async (q: MatrixQuery) => {
      if (q.sources.length === 1 && q.destinations.length > 1) {
        return { durations: [[1800, null, 3600]], distances: null }
      }
      return { durations: [[2000], [null]], distances: null }
    })
    const out = await priceDetours(origin, destination, candidates, { matrix })
    expect(out).toHaveLength(2)
    expect(out[0].detourS).toBe(200)
    expect(out[1].detourS).toBeNull()
  })

  it('splits into multiple chunks without exceeding the coordinate cap', async () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      candidate(`c${i}`, 48.7 - i / 100, 9.2 + i / 100, i * 1000),
    )
    const matrix = vi.fn(async (q: MatrixQuery) => {
      expect(q.coordinates.length).toBeLessThanOrEqual(MATRIX_MAX_COORDS)
      if (q.sources.length === 1 && q.destinations.length > 1) {
        return {
          durations: [
            q.destinations.map((_, i) => (i === q.destinations.length - 1 ? 3600 : 1800)),
          ],
          distances: null,
        }
      }
      return { durations: q.sources.map(() => [2000]), distances: null }
    })
    const out = await priceDetours(origin, destination, candidates, { matrix, limit: 30 })
    expect(matrix).toHaveBeenCalledTimes(4) // 23 + 7 => two chunks => four requests
    expect(out.every((c) => c.detourS === 200)).toBe(true)
  })

  it('only prices up to the limit, leaving the rest unpriced', async () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      candidate(`c${i}`, 48.7, 9.2 + i / 100, i * 1000),
    )
    const matrix = fakeMatrix(Array(3).fill(1800), Array(3).fill(2000), 3600)
    const out = await priceDetours(origin, destination, candidates, { matrix, limit: 3 })
    expect(matrix).toHaveBeenCalledTimes(2)
    expect(out.slice(0, 3).every((c) => c.detourS === 200)).toBe(true)
    expect(out.slice(3).every((c) => c.detourS === null)).toBe(true)
    expect(out).toHaveLength(10)
  })

  it('threads the route penalty through to every priced charger', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000)]
    const matrix = fakeMatrix([3_000], [900], 3_600)
    const [out] = await priceDetours(origin, destination, candidates, {
      matrix,
      penaltyS: 300,
    })
    expect(out.detourS).toBe(3_000 + 900 - 3_600 - 300)
  })

  it('keeps the two driving legs, which cost nothing extra to carry', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000)]
    const matrix = fakeMatrix([1800], [2000], 3600, {
      toCharger: [42_000],
      fromCharger: [51_000],
      dDirect: 88_000,
    })
    const [out] = await priceDetours(origin, destination, candidates, { matrix })

    expect(out.legs).toEqual({
      toChargerM: 42_000,
      toChargerS: 1800,
      fromChargerM: 51_000,
      fromChargerS: 2000,
    })
    expect(out.detourM).toBe(42_000 + 51_000 - 88_000)
  })

  it('still prices the detour when Mapbox refuses the distance annotation', async () => {
    const candidates = [candidate('a', 48.7, 9.3, 10_000)]
    const matrix = fakeMatrix([1800], [2000], 3600)
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
    const matrix = fakeMatrix([1800], [2000], 3600, {
      toCharger: [42_000],
      fromCharger: [51_000],
      dDirect: 88_000,
    })
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
