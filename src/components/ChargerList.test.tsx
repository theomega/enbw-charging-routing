// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ChargerOnRoute } from '../core/types'
import { ChargerList } from './ChargerList'

// The panel carries a live GL map, which has no business in this test.
vi.mock('./RouteMap', () => ({ RouteMap: () => null }))

// jsdom implements no layout, so it has no scrollIntoView. The list calls it to
// centre a row opened from the map; here it only needs to not throw.
Element.prototype.scrollIntoView = vi.fn()

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
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const id = Number(String(input).split('/').pop())
    return new Response(
      JSON.stringify({
        stationId: id,
        availablePoints: 3,
        totalPoints: 4,
        unknownPoints: 0,
        operatorCode: null,
        alwaysOpen: true,
        chargePoints: [],
      }),
      { status: 200 },
    )
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const listProps = (over: Record<string, unknown> = {}) => ({
  status: 'ready' as const,
  results: [row(1), row(46)],
  unfilteredCount: 2,
  progress: null,
  error: null,
  expandedId: null,
  onToggle: () => {},
  route: null,
  // Row 46 is outside the pipeline's reach, exactly like the real case.
  enrichedIds: new Set(['enbw:1']),
  refreshingIds: new Set<string>(),
  refreshNonce: 0,
  ...over,
})

describe('ChargerList refresh of a row past ENRICHED_LIMIT', () => {
  it('re-fetches the opened non-enriched row when the nonce is bumped', async () => {
    const spy = stubFetch()
    const { rerender } = render(<ChargerList {...listProps({ expandedId: 'enbw:46' })} />)

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(String(spy.mock.calls[0][0])).toBe('/api/chargers/46')

    await act(async () => {
      rerender(<ChargerList {...listProps({ expandedId: 'enbw:46', refreshNonce: 1 })} />)
    })

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    expect(String(spy.mock.calls[1][0])).toBe('/api/chargers/46')
  })

  it('shows a spinner on that row while the re-read is in flight', async () => {
    const spy = stubFetch()
    const { rerender } = render(<ChargerList {...listProps({ expandedId: 'enbw:46' })} />)
    await waitFor(() => expect(screen.getByText('3/4 free')).toBeTruthy())

    let release: () => void = () => {}
    spy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify({ stationId: 46, availablePoints: 2, totalPoints: 4 }), {
                status: 200,
              }),
            )
        }),
    )

    rerender(<ChargerList {...listProps({ expandedId: 'enbw:46', refreshNonce: 1 })} />)

    await waitFor(() => {
      const badge = screen.getByText('3/4 free').closest('span')
      expect(badge?.getAttribute('aria-busy')).toBe('true')
    })

    await act(async () => release())
    await waitFor(() => expect(screen.getByText('2/4 free')).toBeTruthy())
  })
})
