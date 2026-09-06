import { describe, expect, it } from 'vitest'
import { appleMapsUrl, googleMapsUrl, isApplePlatform, navigationUrl } from './deepLinks'

const charger = { lat: 48.4131, lon: 9.9526, name: 'Seligweiler' }

describe('deep links', () => {
  it('builds an Apple Maps driving link', () => {
    expect(appleMapsUrl(charger)).toBe('https://maps.apple.com/?daddr=48.4131%2C9.9526&dirflg=d')
  })

  it('builds a Google Maps driving link', () => {
    expect(googleMapsUrl(charger)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=48.4131%2C9.9526&travelmode=driving',
    )
  })

  it('detects iPhone and touch-capable iPadOS, which masquerades as a Mac', () => {
    expect(isApplePlatform('iPhone; CPU iPhone OS 17_0', 5)).toBe(true)
    expect(isApplePlatform('Macintosh; Intel Mac OS X', 5)).toBe(true) // iPadOS
    expect(isApplePlatform('Macintosh; Intel Mac OS X', 0)).toBe(false) // real Mac
    expect(isApplePlatform('Linux; Android 14', 5)).toBe(false)
  })

  it('honours an explicit preference over platform detection', () => {
    expect(navigationUrl(charger, 'google')).toContain('google.com')
    expect(navigationUrl(charger, 'apple')).toContain('maps.apple.com')
  })
})
