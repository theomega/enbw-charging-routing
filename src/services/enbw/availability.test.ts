import { describe, expect, it, vi } from 'vitest'
import { fetchAvailability, type OccupancyRecord } from './availability'

const record = (over: Partial<OccupancyRecord> & { stationId: number }): OccupancyRecord => ({
  availablePoints: 2,
  totalPoints: 4,
  unknownPoints: 0,
  ...over,
})

const charger = (id: number) => ({ id: `enbw:${id}` })

describe('fetchAvailability', () => {
  it('asks for exactly the station ids it was given', async () => {
    const fetcher = vi.fn(async () => [])
    await fetchAvailability([charger(1), charger(2)], { fetcher })
    expect(fetcher).toHaveBeenCalledWith([1, 2], undefined)
  })

  it('maps occupancy back onto the requested chargers', async () => {
    const fetcher = vi.fn(async () => [
      record({ stationId: 1, availablePoints: 3, totalPoints: 4 }),
      record({ stationId: 2, availablePoints: 0, totalPoints: 2 }),
    ])
    const { live, missing } = await fetchAvailability([charger(1), charger(2)], { fetcher })

    expect(live.get('enbw:1')?.availablePoints).toBe(3)
    // Zero free is a measurement, and must survive as one.
    expect(live.get('enbw:2')?.availablePoints).toBe(0)
    expect(missing).toEqual([])
  })

  /**
   * EnBW re-issues station ids in bulk — 71 of 124 shipped Austrian ids went
   * 404 within four days. The row keeps its address and point count from the
   * list; only the badge is unknown.
   */
  it('reports a station the upstream no longer knows, rather than reporting zero free', async () => {
    const fetcher = vi.fn(async () => [record({ stationId: 1 })])
    const { live, missing } = await fetchAvailability([charger(1), charger(999)], { fetcher })

    expect(live.has('enbw:1')).toBe(true)
    expect(live.has('enbw:999')).toBe(false)
    expect(live.get('enbw:999')).toBeUndefined()
    expect(missing).toEqual(['enbw:999'])
  })

  it('ignores a station it did not ask about', async () => {
    const fetcher = vi.fn(async () => [record({ stationId: 1 }), record({ stationId: 42 })])
    const { live } = await fetchAvailability([charger(1)], { fetcher })
    expect([...live.keys()]).toEqual(['enbw:1'])
  })

  /**
   * The Worker omits totalPoints when upstream does not report it, so the
   * count the shipped list already knows is not overwritten with a zero.
   */
  it('omits totalPoints when the upstream did not report one', async () => {
    const fetcher = vi.fn(async () => [
      { stationId: 1, availablePoints: 2, unknownPoints: 0 } as OccupancyRecord,
    ])
    const { live } = await fetchAvailability([charger(1)], { fetcher })
    expect(live.get('enbw:1')).toEqual({ availablePoints: 2, unknownPoints: 0 })
    expect('totalPoints' in live.get('enbw:1')!).toBe(false)
  })

  it('makes no request for an empty candidate list', async () => {
    const fetcher = vi.fn()
    const { live, missing } = await fetchAvailability([], { fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    expect(live.size).toBe(0)
    expect(missing).toEqual([])
  })
})
