// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChargerOnRoute } from '../core/types'
import { useAvailability } from './useAvailability'

const row = (n: number): ChargerOnRoute =>
  ({
    charger: {
      id: `enbw:${n}`,
      name: `Station ${n}`,
      lat: 48,
      lon: 11,
      maxPowerKw: 150,
      totalPoints: 4,
      availablePoints: null,
      chargePoints: null,
    },
    alongDistanceM: n * 1000,
    alongDurationS: n * 60,
    offsetM: 10,
    detourS: null,
    detourM: null,
  }) as ChargerOnRoute

const stubFetch = () => {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = Number(String(input).split('/').pop())
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return new Response(JSON.stringify({ stationId: id, availablePoints: 3, totalPoints: 4 }), {
      status: 200,
    })
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const candidates = [row(1), row(2), row(3)]

describe('useAvailability pending', () => {
  it('empties once every station has answered', async () => {
    stubFetch()
    const { result } = renderHook(() => useAvailability(candidates, 0))
    await waitFor(() => expect(result.current.fetchedAt).not.toBeNull())
    expect([...result.current.pending]).toEqual([])
  })

  /** The Refresh button is disabled on this set, so a stuck pending bricks it. */
  it('empties under StrictMode, whose double-invoke aborts the first attempt', async () => {
    stubFetch()
    const { result } = renderHook(() => useAvailability(candidates, 0), { wrapper: StrictMode })
    await waitFor(() => expect(result.current.fetchedAt).not.toBeNull())
    await waitFor(() => expect([...result.current.pending]).toEqual([]))
  })

  it('empties again after a nonce bump', async () => {
    stubFetch()
    const { result, rerender } = renderHook(({ n }) => useAvailability(candidates, n), {
      initialProps: { n: 0 },
    })
    await waitFor(() => expect([...result.current.pending]).toEqual([]))

    await act(async () => {
      rerender({ n: 1 })
    })
    await waitFor(() => expect([...result.current.pending]).toEqual([]))
  })

  it('empties even when every station fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 502 })),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useAvailability(candidates, 0))
    await waitFor(() => expect([...result.current.pending]).toEqual([]))
  })
})
