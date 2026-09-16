// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChargerOnRoute } from '../core/types'
import { ChargerList } from './ChargerList'

// The panel carries a live GL map, which has no business in this test.
vi.mock('./RouteMap', () => ({ RouteMap: () => null }))

// jsdom implements no layout, so it has no scrollIntoView. The list calls it
// when a row opens; here it only needs to not throw.
Element.prototype.scrollIntoView = vi.fn()

const row = (n: number): ChargerOnRoute =>
  ({
    charger: {
      id: `enbw:${n}`,
      name: `Station ${n}`,
      lat: 48,
      lon: 11,
      maxPowerKw: 150,
      availablePoints: null,
      chargePoints: null,
    },
    alongDistanceM: n * 1000,
    alongDurationS: n * 60,
    offsetM: 10,
    detourS: null,
    detourM: null,
  }) as ChargerOnRoute

/** Four 300 kW points, `free` of them reported free and the rest in use. */
const points = (free: number) =>
  Array.from({ length: 4 }, (_, i) => ({
    id: `DE*ENB*E1*${i}`,
    plugs: ['CCS (Typ 2)'],
    maxPowerKw: 300,
    status: i < free ? 'AVAILABLE' : 'OCCUPIED',
  }))

const stubFetch = () => {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const id = Number(String(input).split('/').pop())
    return new Response(
      JSON.stringify({
        stationId: id,
        availablePoints: 3,
        unknownPoints: 0,
        operatorCode: null,
        alwaysOpen: true,
        chargePoints: points(3),
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

/**
 * The reported bug, at the level the tester saw it: a hub listed for its fast
 * stalls counting the 22 kW AC posts beside them.
 */
describe('ChargerList point count', () => {
  const hub = (): ChargerOnRoute => {
    const base = row(1)
    return {
      ...base,
      charger: {
        ...base.charger,
        availablePoints: 3,
        chargePoints: [
          { id: null, plugs: ['CCS (Typ 2)'], maxPowerKw: 300, status: 'AVAILABLE' },
          { id: null, plugs: ['CCS (Typ 2)'], maxPowerKw: 300, status: 'OCCUPIED' },
          { id: null, plugs: ['Typ 2'], maxPowerKw: 22, status: 'AVAILABLE' },
          { id: null, plugs: ['Typ 2'], maxPowerKw: 22, status: 'AVAILABLE' },
        ],
      },
    }
  }

  it('counts only the Ladesäulen above the setting', () => {
    render(<ChargerList {...listProps({ results: [hub()], enrichedIds: new Set(['enbw:1']) })} />)
    expect(screen.getByText('1/2 frei')).toBeTruthy()
    expect(screen.queryByText('3/4 frei')).toBeNull()
  })
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
    await waitFor(() => expect(screen.getByText('3/4 frei')).toBeTruthy())

    let release: () => void = () => {}
    spy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              new Response(
                JSON.stringify({ stationId: 46, availablePoints: 2, chargePoints: points(2) }),
                { status: 200 },
              ),
            )
        }),
    )

    rerender(<ChargerList {...listProps({ expandedId: 'enbw:46', refreshNonce: 1 })} />)

    await waitFor(() => {
      const badge = screen.getByText('3/4 frei').closest('span')
      expect(badge?.getAttribute('aria-busy')).toBe('true')
    })

    await act(async () => release())
    await waitFor(() => expect(screen.getByText('2/4 frei')).toBeTruthy())
  })
})
