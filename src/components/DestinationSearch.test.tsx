// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Suggestion } from '../services/mapbox/searchBox'
import { DestinationSearch } from './DestinationSearch'

const suggest = vi.fn()
const resolve = vi.fn()

vi.mock('../services/mapbox/searchBox', () => ({
  createDestinationSearch: () => ({ suggest, resolve }),
}))

const row = (over: Partial<Suggestion> = {}): Suggestion =>
  ({
    id: 'id-bozen',
    name: 'Bozen',
    context: 'Südtirol, Italien',
    featureType: 'place',
    maki: 'marker',
    raw: {},
    ...over,
  }) as Suggestion

const type = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText('Was ist das Ziel der Reise?'), {
    target: { value: text },
  })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DestinationSearch', () => {
  it('resolves the tapped suggestion into a destination', async () => {
    suggest.mockResolvedValue([row()])
    const place = { id: 'id-bozen', name: 'Bozen', context: 'Südtirol, Italien', lat: 46, lon: 11 }
    resolve.mockResolvedValue(place)
    const onPick = vi.fn()

    render(<DestinationSearch onPick={onPick} onClose={() => {}} />)
    type('Bozen')

    fireEvent.click(await screen.findByText('Bozen'))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(place))
  })

  it('reports a suggestion that cannot be retrieved, naming it', async () => {
    // The second call is its own round trip, so it has its own failure.
    suggest.mockResolvedValue([row()])
    resolve.mockRejectedValue(new Error('Mapbox-Fehler 429: rate limited'))

    render(<DestinationSearch onPick={() => {}} onClose={() => {}} />)
    type('Bozen')

    fireEvent.click(await screen.findByText('Bozen'))
    expect(await screen.findByText(/„Bozen“ konnte nicht geladen werden/)).toBeTruthy()
    expect(screen.getByText(/429/)).toBeTruthy()
  })

  it('does not search for a query of one character', async () => {
    suggest.mockResolvedValue([])

    render(<DestinationSearch onPick={() => {}} onClose={() => {}} />)
    type('B')

    await new Promise((r) => setTimeout(r, 400))
    expect(suggest).not.toHaveBeenCalled()
  })

  it('asks for the trimmed query', async () => {
    suggest.mockResolvedValue([row()])

    render(<DestinationSearch onPick={() => {}} onClose={() => {}} />)
    type('  Bozen  ')

    await waitFor(() => expect(suggest).toHaveBeenCalledWith('Bozen', expect.anything()))
  })

  it('settles the spinner when a request is superseded mid-flight', async () => {
    // Regression: the library's own SearchSession never settles the superseded
    // promise, which left „Suche läuft…" on screen for good.
    const first: { release?: (rows: Suggestion[]) => void } = {}
    suggest
      .mockImplementationOnce(
        () =>
          new Promise<Suggestion[]>((r) => {
            first.release = r
          }),
      )
      .mockResolvedValue([row({ name: 'Bozen' })])

    render(<DestinationSearch onPick={() => {}} onClose={() => {}} />)
    type('Boz')
    await waitFor(() => expect(suggest).toHaveBeenCalledTimes(1))
    type('Bozen')
    first.release?.([])

    expect(await screen.findByText('Bozen')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Suche läuft…')).toBeNull())
  })
})
