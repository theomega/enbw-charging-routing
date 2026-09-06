import type { Charger } from '../core/types'

export type MapsApp = 'auto' | 'apple' | 'google'

/**
 * Single-stop by design. Google supports `waypoints=` to chain charger then
 * destination, but Apple has no reliable multi-stop URL scheme — matching them
 * avoids the handoff behaving differently depending on the phone.
 */
export function appleMapsUrl(c: Pick<Charger, 'lat' | 'lon' | 'name'>): string {
  const params = new URLSearchParams({ daddr: `${c.lat},${c.lon}`, dirflg: 'd' })
  return `https://maps.apple.com/?${params.toString()}`
}

export function googleMapsUrl(c: Pick<Charger, 'lat' | 'lon' | 'name'>): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${c.lat},${c.lon}`,
    travelmode: 'driving',
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/** True for iPhone/iPad, including iPadOS which reports itself as a Mac. */
export function isApplePlatform(ua: string = navigator.userAgent, maxTouchPoints = navigator.maxTouchPoints): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return /Macintosh/i.test(ua) && maxTouchPoints > 1
}

export function navigationUrl(
  charger: Pick<Charger, 'lat' | 'lon' | 'name'>,
  preference: MapsApp,
): string {
  const useApple = preference === 'apple' || (preference === 'auto' && isApplePlatform())
  return useApple ? appleMapsUrl(charger) : googleMapsUrl(charger)
}
