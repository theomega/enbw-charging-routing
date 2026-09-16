// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  remainingDistanceM: 400_000,
  drivenM: 0,
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

/**
 * jsdom implements no layout, so the anchor has to be given one. Every row div
 * — a classless direct child of the list container — is placed on a fake
 * `ROW_H` grid in render order and offset by the stubbed scroll position,
 * which is exactly the geometry the correction reasons about.
 */
const ROW_H = 200

const isRow = (el: Element): boolean =>
  el.tagName === 'DIV' && el.className === '' && !!el.parentElement?.className.includes('space-y-3')

function fakeLayout(scrollY: number) {
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true, writable: true })
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (!isRow(this)) return { top: 0, bottom: 0, height: 0 } as DOMRect
    const index = Array.prototype.indexOf.call(this.parentElement!.children, this)
    const top = index * ROW_H - scrollY
    return { top, bottom: top + ROW_H, height: ROW_H } as DOMRect
  }
}

describe('ChargerList while the list is rebuilt', () => {
  const original = Element.prototype.getBoundingClientRect

  afterEach(() => {
    Element.prototype.getBoundingClientRect = original
  })

  it('keeps the rows it has instead of replacing them with skeletons', () => {
    render(<ChargerList {...listProps({ status: 'placing', progress: 0.4 })} />)
    expect(screen.getByText('Station 1')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('still shows skeletons on the first load, where there is nothing to keep', () => {
    render(<ChargerList {...listProps({ status: 'placing', progress: 0.4, results: [] })} />)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByText('Station 1')).toBeNull()
  })

  /**
   * The reported bug. Two stations drop off the front because the car passed
   * them, and the station the driver was reading must stay where it is on
   * screen rather than sliding up by their combined height.
   */
  it('holds the station being read when passed ones drop off the front', () => {
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    fakeLayout(450)

    const all = [row(1), row(2), row(3), row(4), row(5)]
    const { rerender } = render(<ChargerList {...listProps({ results: all, drivenM: 0 })} />)

    // Station 3 is the topmost row still visible, sitting 50 px above the fold.
    rerender(<ChargerList {...listProps({ results: all.slice(2), drivenM: 2_000 })} />)

    // It is now the first row, so the page must scroll up by the two rows that
    // left — anything else moves it under the driver's eye.
    expect(scrollBy).toHaveBeenCalledWith(0, -2 * ROW_H)
  })

  it('does not correct when the list changed for a reason other than driving', () => {
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    fakeLayout(450)

    const all = [row(1), row(2), row(3), row(4), row(5)]
    const { rerender } = render(<ChargerList {...listProps({ results: all, drivenM: 0 })} />)

    // A tightened power filter: same driver position, fewer rows. The driver
    // just changed what the list is and is looking for it from the top.
    rerender(<ChargerList {...listProps({ results: all.slice(2), drivenM: 0 })} />)

    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('goes to the top when the station being read is gone', () => {
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    vi.stubGlobal('scrollBy', vi.fn())
    fakeLayout(450)

    const all = [row(1), row(2), row(3), row(4), row(5)]
    const { rerender } = render(<ChargerList {...listProps({ results: all, drivenM: 0 })} />)

    // Station 3 was the anchor; the driver is now past it and out of its grace.
    rerender(<ChargerList {...listProps({ results: all.slice(3), drivenM: 4_000 })} />)

    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('leaves a list already at the top alone', () => {
    const scrollBy = vi.fn()
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    vi.stubGlobal('scrollTo', scrollTo)
    fakeLayout(0)

    const all = [row(1), row(2), row(3)]
    const { rerender } = render(<ChargerList {...listProps({ results: all, drivenM: 0 })} />)
    rerender(<ChargerList {...listProps({ results: all.slice(1), drivenM: 2_000 })} />)

    expect(scrollBy).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('ChargerList share action', () => {
  const station = (): ChargerOnRoute => {
    const base = row(1)
    return {
      ...base,
      charger: { ...base.charger, notes: 'Seligweiler', address: 'Kelternweg 124, 89075 Ulm' },
    }
  }

  const stubShareSheet = (canShare: boolean) => {
    const share = vi.fn<(data: ShareData) => Promise<void>>(() => Promise.resolve())
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'canShare', {
      value: () => canShare,
      configurable: true,
    })
    return share
  }

  afterEach(() => {
    // vi.unstubAllGlobals does not reach a defineProperty on navigator.
    Reflect.deleteProperty(navigator, 'share')
    Reflect.deleteProperty(navigator, 'canShare')
  })

  it('hides the control where the browser has no share sheet', () => {
    stubShareSheet(false)
    render(<ChargerList {...listProps({ results: [station()], expandedId: 'enbw:1' })} />)

    expect(screen.queryByLabelText('Ladestation teilen')).toBeNull()
    expect(screen.getByText('Hierhin navigieren')).toBeTruthy()
  })

  it('shares the Apple place card, with the station named in the text', () => {
    const share = stubShareSheet(true)
    render(<ChargerList {...listProps({ results: [station()], expandedId: 'enbw:1' })} />)

    fireEvent.click(screen.getByLabelText('Ladestation teilen'))
    fireEvent.click(screen.getByText('Apple Maps Link teilen'))

    expect(share).toHaveBeenCalledWith({
      title: 'Seligweiler',
      text: 'Seligweiler, Kelternweg 124, 89075 Ulm',
      url: 'https://maps.apple.com/place?coordinate=48%2C11&name=Seligweiler',
    })
  })

  it('shares the unlabelled Google coordinate link', () => {
    const share = stubShareSheet(true)
    render(<ChargerList {...listProps({ results: [station()], expandedId: 'enbw:1' })} />)

    fireEvent.click(screen.getByLabelText('Ladestation teilen'))
    fireEvent.click(screen.getByText('Google Maps Link teilen'))

    expect(share.mock.calls[0][0]).toMatchObject({
      url: 'https://www.google.com/maps/search/?api=1&query=48%2C11',
    })
  })

  it('closes the menu once an action is taken', () => {
    stubShareSheet(true)
    render(<ChargerList {...listProps({ results: [station()], expandedId: 'enbw:1' })} />)

    fireEvent.click(screen.getByLabelText('Ladestation teilen'))
    fireEvent.click(screen.getByText('Google Maps Link teilen'))

    expect(screen.queryByText('Google Maps Link teilen')).toBeNull()
  })
})
