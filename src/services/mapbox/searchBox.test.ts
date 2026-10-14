import { polyfillFetch } from '@mapbox/search-js-core'
import { describe, expect, it, vi } from 'vitest'
import { createDestinationSearch, preferredLanguage } from './searchBox'

// The library captures globalThis.fetch when its own module loads, so stubbing
// the global afterwards is invisible to it. `force` is the documented way in.
const stubFetch = (handler: (url: string) => unknown) => {
  const calls: string[] = []
  const fetch = vi.fn(async (url: string) => {
    calls.push(url)
    return new Response(JSON.stringify(handler(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  polyfillFetch({ fetch: fetch as unknown as typeof globalThis.fetch, AbortController }, true)
  return calls
}

const newSearch = () => createDestinationSearch('de', () => 'pk.test')

const suggestion = (over: Record<string, unknown> = {}) => ({
  name: 'Bozen',
  mapbox_id: 'id-bozen',
  feature_type: 'place',
  place_formatted: 'Südtirol, Italien',
  full_address: '',
  address: '',
  maki: 'marker',
  ...over,
})

const feature = (properties: Record<string, unknown>) => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [11.3548, 46.4983] },
      properties,
    },
  ],
})

const answer = (url: string) =>
  url.includes('/suggest')
    ? { suggestions: [suggestion()] }
    : feature({ name: 'Bozen', mapbox_id: 'id-bozen' })

describe('suggest', () => {
  it('aims proximity at null island rather than omitting it', async () => {
    // Regression: omitting `proximity` is not "no bias" but IP proximity, and
    // that ranks the places nearest the phone first — „Bozen" measured from
    // Berlin returned five Berlin businesses under the real Bozen.
    const calls = stubFetch(answer)
    await newSearch().suggest('Bozen')

    const url = new URL(calls[0])
    expect(url.searchParams.get('proximity')).toBe('0,0')
    expect(url.searchParams.get('origin')).toBeNull()
  })

  it('sends the query, the language and a result limit', async () => {
    const calls = stubFetch(answer)
    await newSearch().suggest('Bozen')

    const url = new URL(calls[0])
    expect(url.searchParams.get('q')).toBe('Bozen')
    expect(url.searchParams.get('language')).toBe('de')
    expect(url.searchParams.get('limit')).toBe('10')
  })

  it('does not restrict results to one country', async () => {
    // Regression: `country=de` made destinations abroad unfindable, e.g.
    // "Segenbühelweg 15, 39019 Dorf Tirol, Italien".
    const calls = stubFetch(answer)
    await newSearch().suggest('Dorf Tirol')

    expect(new URL(calls[0]).searchParams.get('country')).toBeNull()
  })

  it('drops the rows that are a refinement rather than a place', async () => {
    // „Hotel" answers with a `category` row that retrieves to zero features
    // and a `brand` row that retrieves to three hotels in two countries.
    stubFetch(() => ({
      suggestions: [
        suggestion({ name: 'Hotel', mapbox_id: 'cat', feature_type: 'category' }),
        suggestion({ name: 'Hotel Indigo', mapbox_id: 'brand', feature_type: 'brand' }),
        suggestion({ name: 'Hotel MANI', mapbox_id: 'poi', feature_type: 'poi', maki: 'lodging' }),
      ],
    }))

    const rows = await newSearch().suggest('Hotel')
    expect(rows.map((r) => r.name)).toEqual(['Hotel MANI'])
    expect(rows[0].maki).toBe('lodging')
  })
})

describe('session billing', () => {
  const tokensOf = (calls: string[]) =>
    calls.map((c) => new URL(c).searchParams.get('session_token'))

  it('bills one session across many keystrokes and the pick that ends it', async () => {
    const calls = stubFetch(answer)
    const search = newSearch()

    await search.suggest('Boz')
    await search.suggest('Boze')
    const rows = await search.suggest('Bozen')
    await search.resolve(rows[0])

    expect(calls).toHaveLength(4)
    expect(new Set(tokensOf(calls)).size).toBe(1)
  })

  it('opens a new session only after a pick', async () => {
    const calls = stubFetch(answer)
    const search = newSearch()

    const rows = await search.suggest('Bozen')
    await search.resolve(rows[0])
    await search.suggest('Meran')

    const [first, pick, next] = tokensOf(calls)
    expect(first).toBe(pick)
    expect(next).not.toBe(pick)
  })
})

describe('resolve', () => {
  it('takes the coordinates from the feature and the wording from the row', async () => {
    stubFetch((url) =>
      url.includes('/suggest')
        ? { suggestions: [suggestion()] }
        : // Mapbox words the retrieved feature differently; the row the driver
          // tapped is what the destination should read back as.
          feature({ name: 'Bolzano', place_formatted: 'Trentino, Italy' }),
    )

    const search = newSearch()
    const rows = await search.suggest('Bozen')

    expect(await search.resolve(rows[0])).toEqual({
      id: 'id-bozen',
      name: 'Bozen',
      context: 'Südtirol, Italien',
      lat: 46.4983,
      lon: 11.3548,
    })
  })

  it('fails loudly when the retrieve carries no feature', async () => {
    // A 200 with an empty collection is what a refinement row answers; this
    // guards the case where one reaches `resolve` anyway.
    stubFetch((url) =>
      url.includes('/suggest')
        ? { suggestions: [suggestion()] }
        : { type: 'FeatureCollection', features: [] },
    )

    const search = newSearch()
    const rows = await search.suggest('Bozen')
    await expect(search.resolve(rows[0])).rejects.toThrow(/keine Koordinaten/)
  })
})

describe('preferredLanguage', () => {
  it('reduces a locale tag to its primary subtag', () => {
    expect(preferredLanguage('de-DE')).toBe('de')
    expect(preferredLanguage('it')).toBe('it')
    expect(preferredLanguage('en-GB')).toBe('en')
  })

  it('falls back to en for junk', () => {
    expect(preferredLanguage('')).toBe('en')
    expect(preferredLanguage('!!')).toBe('en')
  })
})
