import { describe, expect, it, vi } from 'vitest'
import { eastwardRoute } from '../test/routes'
import { buildCorridor, placeChargersOnRoute } from './corridor'
import type { Charger } from './types'

function charger(id: string, lat: number, lon: number): Charger {
  return {
    id,
    providerId: 'enbw',
    name: id,
    address: null,
    lat,
    lon,
    availablePoints: 2,
    unknownPoints: 0,
    maxPowerKw: 150,
    operator: 'EnBW',
    operatorCode: 'DEEBW',
    priceGroup: 'ENBW_GROUP',
    alwaysOpen: true,
    chargePoints: null,
    pointPowers: null,
    notes: null,
  }
}

describe('buildCorridor', () => {
  it('buffers the route into a polygon that admits what is near it', () => {
    const corridor = buildCorridor(eastwardRoute(), 5_000)
    expect(corridor.area).not.toBeNull()
    expect(corridor.admits({ lat: 48.8, lon: 9.05 })).toBe(true)
    expect(corridor.admits({ lat: 49.5, lon: 9.05 })).toBe(false) // ~78 km north
  })

  it('admits everything when the route is too degenerate to buffer', () => {
    const corridor = buildCorridor(
      {
        coordinates: [[9, 48.8]],
        distances: [],
        durations: [],
        totalDistanceM: 0,
        totalDurationS: 0,
      },
      5_000,
    )
    expect(corridor.area).toBeNull()
    expect(corridor.admits({ lat: 0, lon: 0 })).toBe(true)
  })

  /**
   * The gate only decides what is worth measuring. If it ever rejected a
   * charger the exact projection would have kept, that charger would vanish
   * from the list — so it must be a strict superset of the corridor.
   */
  it('never rejects a charger the exact test would keep', () => {
    const route = eastwardRoute(21)
    const corridor = buildCorridor(route, 5_000)
    const geometry = corridor.geometry

    for (let dLat = -60; dLat <= 60; dLat++) {
      for (let dLon = -4; dLon <= 24; dLon++) {
        const point = { lat: 48.8 + dLat * 0.001, lon: 9.0 + dLon * 0.01 }
        if (geometry.project(point).offsetM <= 5_000) {
          expect(corridor.admits(point)).toBe(true)
        }
      }
    }
  })
})

describe('placeChargersOnRoute', () => {
  it('drops chargers beyond the corridor and orders the rest by arrival', async () => {
    const corridor = buildCorridor(eastwardRoute(), 5_000)
    const result = await placeChargersOnRoute(corridor, [
      charger('far', 48.8, 9.08),
      charger('near', 48.8, 9.02),
      charger('way-off', 49.5, 9.05), // ~78 km north
    ])
    expect(result.map((r) => r.charger.id)).toEqual(['near', 'far'])
  })

  it('leaves detour unpriced until the matrix step runs', async () => {
    const corridor = buildCorridor(eastwardRoute(), 5_000)
    const [first] = await placeChargersOnRoute(corridor, [charger('a', 48.8, 9.02)])
    expect(first.detourS).toBeNull()
  })

  it('carries the route point the detour will be priced against', async () => {
    const corridor = buildCorridor(eastwardRoute(), 5_000)
    // 0.009 degrees north of an east-west route is ~1 km off it.
    const [first] = await placeChargersOnRoute(corridor, [charger('a', 48.809, 9.02)])
    expect(first.offsetM).toBeGreaterThan(950)
    expect(first.routePoint.lat).toBeCloseTo(48.8, 5)
    expect(first.routePoint.lon).toBeCloseTo(9.02, 5)
  })

  it('reports progress from start to finish so the bar can move', async () => {
    const corridor = buildCorridor(eastwardRoute(), 5_000)
    const chargers = Array.from({ length: 25 }, (_, i) => charger(`c${i}`, 48.8, 9.0 + i * 0.002))
    const onProgress = vi.fn()

    await placeChargersOnRoute(corridor, chargers, { onProgress, chunkSize: 5 })

    const seen = onProgress.mock.calls.map(([f]) => f as number)
    expect(seen[0]).toBe(0)
    expect(seen.at(-1)).toBe(1)
    // Monotonic, or the bar would jump backwards.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
    expect(seen.length).toBeGreaterThan(2)
  })

  it('reports done immediately for an empty list', async () => {
    const corridor = buildCorridor(eastwardRoute(), 5_000)
    const onProgress = vi.fn()
    expect(await placeChargersOnRoute(corridor, [], { onProgress })).toEqual([])
    expect(onProgress).toHaveBeenCalledWith(1)
  })

  it('stops when the caller aborts', async () => {
    const corridor = buildCorridor(eastwardRoute(), 5_000)
    const chargers = Array.from({ length: 50 }, (_, i) => charger(`c${i}`, 48.8, 9.0 + i * 0.001))
    const controller = new AbortController()
    controller.abort()

    await expect(
      placeChargersOnRoute(corridor, chargers, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i)
  })
})
