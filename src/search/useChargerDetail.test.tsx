// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { Charger } from '../core/types'
import { useChargerDetail } from './useChargerDetail'

/**
 * A station past `ENRICHED_LIMIT`: the pipeline never looked it up, so it
 * carries no `chargePoints` and this hook owns its lookup.
 */
const shipped = (over: Partial<Charger> = {}): Charger =>
  ({
    id: 'enbw:4242',
    name: 'Somewhere',
    lat: 48,
    lon: 11,
    maxPowerKw: 150,
    totalPoints: 4,
    availablePoints: null,
    chargePoints: null,
    ...over,
  }) as Charger

const stubFetch = () => {
  const spy = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          stationId: 4242,
          availablePoints: 3,
          totalPoints: 4,
          unknownPoints: 0,
          operatorCode: null,
          alwaysOpen: true,
          chargePoints: [],
        }),
        { status: 200 },
      ),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useChargerDetail', () => {
  it('fetches once when the panel is first opened', async () => {
    const spy = stubFetch()
    const charger = shipped()

    const { rerender } = renderHook(({ active }) => useChargerDetail(charger, false, active, 0), {
      initialProps: { active: false },
    })
    expect(spy).not.toHaveBeenCalled()

    rerender({ active: true })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  })

  /** The whole point of threading the nonce: Refresh must re-read this row. */
  it('re-fetches when Refresh bumps the nonce, with the panel still open', async () => {
    const spy = stubFetch()
    const charger = shipped()

    const { rerender } = renderHook(({ nonce }) => useChargerDetail(charger, false, true, nonce), {
      initialProps: { nonce: 0 },
    })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    await act(async () => {
      rerender({ nonce: 1 })
    })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })

  /** A row opened and closed again still shows its badge, so it must refresh. */
  it('re-fetches on Refresh even after the panel was closed', async () => {
    const spy = stubFetch()
    const charger = shipped()

    const { rerender } = renderHook(
      ({ active, nonce }) => useChargerDetail(charger, false, active, nonce),
      { initialProps: { active: true, nonce: 0 } },
    )
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

    rerender({ active: false, nonce: 0 })
    expect(spy).toHaveBeenCalledTimes(1)

    await act(async () => {
      rerender({ active: false, nonce: 1 })
    })
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })

  it('reports loading while a re-read is in flight over an existing record', async () => {
    const spy = stubFetch()
    const charger = shipped()

    const { result, rerender } = renderHook(
      ({ nonce }) => useChargerDetail(charger, false, true, nonce),
      { initialProps: { nonce: 0 } },
    )
    await waitFor(() => expect(result.current.charger?.chargePoints).toEqual([]))
    expect(result.current.loading).toBe(false)

    // Hold the second request open so the in-flight state is observable.
    let release: () => void = () => {}
    spy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify({ stationId: 4242, availablePoints: 1 }), {
                status: 200,
              }),
            )
        }),
    )

    rerender({ nonce: 1 })
    await waitFor(() => expect(result.current.loading).toBe(true))
    // The old numbers stay on screen while it re-reads.
    expect(result.current.charger?.availablePoints).toBe(3)

    await act(async () => {
      release()
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('never fetches a row the pipeline already owns', async () => {
    const spy = stubFetch()
    const { rerender } = renderHook(({ nonce }) => useChargerDetail(shipped(), true, true, nonce), {
      initialProps: { nonce: 0 },
    })
    rerender({ nonce: 1 })
    await new Promise((r) => setTimeout(r, 20))
    expect(spy).not.toHaveBeenCalled()
  })
})
