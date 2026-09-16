import { describe, expect, it } from 'vitest'
import {
  appleMapsUrl,
  applePlaceUrl,
  googleMapsUrl,
  googlePlaceUrl,
  isApplePlatform,
  navigationUrl,
  stationShare,
} from './deepLinks'

const charger = { lat: 48.4131, lon: 9.9526, name: 'Seligweiler' }

/** A station as the list carries one: the sign's name in `notes`, street in `name`. */
const station = {
  lat: 48.4131,
  lon: 9.9526,
  name: 'Kelternweg 124',
  notes: 'Seligweiler',
  address: 'Kelternweg 124, 89075 Ulm',
}

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

describe('place links', () => {
  it('builds a Google place link at the exact coordinate', () => {
    expect(googlePlaceUrl(station)).toBe(
      'https://www.google.com/maps/search/?api=1&query=48.4131%2C9.9526',
    )
  })

  it('labels the Apple place link with the name on the sign', () => {
    expect(applePlaceUrl(station)).toBe(
      'https://maps.apple.com/place?coordinate=48.4131%2C9.9526&name=Seligweiler',
    )
  })

  it('falls back to the street for a station the provider gives no location for', () => {
    expect(applePlaceUrl({ ...station, notes: null })).toContain('name=Kelternweg+124')
  })
})

describe('share payload', () => {
  it('names the station in the text, which the Google link cannot carry', () => {
    expect(stationShare(station, 'google')).toEqual({
      title: 'Seligweiler',
      text: 'Seligweiler, Kelternweg 124, 89075 Ulm',
      url: 'https://www.google.com/maps/search/?api=1&query=48.4131%2C9.9526',
    })
  })

  it('shares the labelled place card for Apple', () => {
    expect(stationShare(station, 'apple').url).toContain('maps.apple.com/place')
  })

  it('leaves the text at the name alone when there is no address', () => {
    expect(stationShare({ ...station, address: null }, 'apple').text).toBe('Seligweiler')
  })
})
