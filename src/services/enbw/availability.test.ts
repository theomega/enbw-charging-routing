import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAvailability,
  fetchViaWorker,
  type LiveStationFetcher,
  type LiveStationRecord,
} from './availability'

const record = (over: Partial<LiveStationRecord> & { stationId: number }): LiveStationRecord => ({
  availablePoints: 2,
  totalPoints: 4,
  unknownPoints: 0,
  operatorCode: null,
  alwaysOpen: null,
  chargePoints: null,
  ...over,
})

const charger = (id: number) => ({ id: `enbw:${id}` })

describe('fetchAvailability', () => {
  it('asks for exactly the station ids it was given', async () => {
    const fetcher = vi.fn(async () => [])
    await fetchAvailability([charger(1), charger(2)], { fetcher })
    expect(fetcher).toHaveBeenCalledWith([1, 2], { signal: undefined })
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
   *
   * The bare record here is also what a Worker running older code answers with,
   * and what a 60 s cache entry written before a deploy still holds — so this
   * doubles as the check that the newer fields degrade to null rather than
   * arriving as undefined and spreading `undefined` over a real charger.
   */
  it('omits totalPoints when the upstream did not report one', async () => {
    const fetcher = vi.fn(async () => [
      { stationId: 1, availablePoints: 2, unknownPoints: 0 } as LiveStationRecord,
    ])
    const { live } = await fetchAvailability([charger(1)], { fetcher })
    const entry = live.get('enbw:1')!
    expect(entry.availablePoints).toBe(2)
    expect(entry.unknownPoints).toBe(0)
    expect('totalPoints' in entry).toBe(false)
    expect(entry.chargePoints).toBeNull()
    expect(entry.alwaysOpen).toBeNull()
  })

  it('makes no request for an empty candidate list', async () => {
    const fetcher = vi.fn()
    const { live, missing } = await fetchAvailability([], { fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    expect(live.size).toBe(0)
    expect(missing).toEqual([])
  })
})

/**
 * The fan-out itself, which is what makes one flaky station cost one badge.
 *
 * The Worker answers a single station per request now, so the policy that used
 * to live in it — keep what came back, drop what did not, but shout if nothing
 * did — lives here instead and is worth pinning down.
 */
describe('fetchViaWorker', () => {
  const stub = (handler: (id: number) => Response | Promise<Response>) => {
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const id = Number(String(input).split('/').pop())
      return handler(id)
    })
    vi.stubGlobal('fetch', spy)
    return spy
  }

  const ok = (id: number) =>
    new Response(JSON.stringify(record({ stationId: id })), { status: 200 })

  afterEach(() => vi.unstubAllGlobals())

  it('asks for one station per request', async () => {
    const spy = stub(ok)
    await fetchViaWorker([1, 2, 3])

    expect(spy).toHaveBeenCalledTimes(3)
    expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/chargers/1',
      '/api/chargers/2',
      '/api/chargers/3',
    ])
  })

  it('drops a 404 without failing the rest', async () => {
    stub((id) => (id === 2 ? new Response('', { status: 404 }) : ok(id)))
    const records = await fetchViaWorker([1, 2, 3])
    expect(records.map((r) => r.stationId)).toEqual([1, 3])
  })

  it('keeps the stations that answered when one errors', async () => {
    stub((id) => (id === 2 ? new Response('boom', { status: 500 }) : ok(id)))
    const records = await fetchViaWorker([1, 2, 3])
    expect(records.map((r) => r.stationId)).toEqual([1, 3])
  })

  /**
   * Nothing came back at all: that is the key having been rotated or the
   * upstream being down, not bad luck, and it has to reach a log with its real
   * message rather than look like a route with no live data on it.
   */
  it('throws when every station fails', async () => {
    stub(() => new Response('gone', { status: 502 }))
    await expect(fetchViaWorker([1, 2])).rejects.toThrow(/502/)
  })

  it('returns empty rather than throwing when every station is merely a 404', async () => {
    stub(() => new Response('', { status: 404 }))
    await expect(fetchViaWorker([1, 2])).resolves.toEqual([])
  })

  /**
   * The per-station report the list's spinners run on. Every id has to be
   * reported exactly once whatever happened to it — a row that is never told
   * its request is over spins for the rest of the session.
   */
  it('reports every station as its own request settles, however it settled', async () => {
    stub((id) => {
      if (id === 2) return new Response('', { status: 404 })
      if (id === 3) return new Response('boom', { status: 500 })
      return ok(id)
    })

    const seen: [number, number | null][] = []
    await fetchViaWorker([1, 2, 3], {
      onRecord: (id, r) => seen.push([id, r?.stationId ?? null]),
    })

    expect(seen.sort((a, b) => a[0] - b[0])).toEqual([
      [1, 1],
      // Answered "no data" rather than not answered: a re-issued id and a
      // failed request both end the row's wait.
      [2, null],
      [3, null],
    ])
  })
})

describe('fetchAvailability progress', () => {
  it('reports each station as a charger id, so a caller never sees station ids', async () => {
    const fetcher: LiveStationFetcher = async (ids, options) => {
      for (const id of ids) options?.onRecord?.(id, id === 1 ? record({ stationId: 1 }) : null)
      return [record({ stationId: 1, availablePoints: 3 })]
    }

    const seen: [string, number | null][] = []
    await fetchAvailability([charger(1), charger(2)], {
      fetcher,
      onStation: (id, station) => seen.push([id, station?.availablePoints ?? null]),
    })

    expect(seen).toEqual([
      ['enbw:1', 2],
      ['enbw:2', null],
    ])
  })

  it('does not report a station nobody asked about', async () => {
    const fetcher: LiveStationFetcher = async (_ids, options) => {
      options?.onRecord?.(42, record({ stationId: 42 }))
      return []
    }

    const seen: string[] = []
    await fetchAvailability([charger(1)], { fetcher, onStation: (id) => seen.push(id) })
    expect(seen).toEqual([])
  })
})
