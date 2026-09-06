import { describe, expect, it } from 'vitest'
import { buildGeocodeUrl, preferredLanguage } from './geocoding'

describe('buildGeocodeUrl', () => {
  const token = 'pk.test'

  it('does not restrict results to one country', () => {
    // Regression: `country=de` made destinations abroad unfindable, e.g.
    // "Segenbühelweg 15, 39019 Dorf Tirol, Italien".
    const url = new URL(buildGeocodeUrl('Dorf Tirol', null, token))
    expect(url.searchParams.get('country')).toBeNull()
    expect(url.searchParams.get('q')).toBe('Dorf Tirol')
  })

  it('biases by proximity instead of excluding, as lon,lat', () => {
    const url = new URL(buildGeocodeUrl('Tirol', { lat: 48.78, lon: 9.18 }, token))
    expect(url.searchParams.get('proximity')).toBe('9.18,48.78')
  })

  it('omits proximity entirely before the first GPS fix', () => {
    const url = new URL(buildGeocodeUrl('Tirol', null, token))
    expect(url.searchParams.get('proximity')).toBeNull()
  })

  it('sends the token and a result limit', () => {
    const url = new URL(buildGeocodeUrl('Ulm', null, token))
    expect(url.searchParams.get('access_token')).toBe(token)
    expect(url.searchParams.get('limit')).toBe('6')
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
