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
export function isApplePlatform(
  ua: string = navigator.userAgent,
  maxTouchPoints = navigator.maxTouchPoints,
): boolean {
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

export type PlaceProvider = 'google' | 'apple'

/**
 * The place links, for handing a station to another person, and deliberately
 * not the navigation pair above.
 *
 * They ignore `MapsApp`, because that setting answers "which app should _this_
 * phone open" and the recipient's phone is not asking it — the driver picks the
 * provider per share instead. And they describe a place rather than a route: a
 * directions link bakes in "from where you are", and whoever receives it is
 * usually not the person driving this route.
 *
 * The same name the card's heading shows, which is the location on the sign you
 * are looking for. Sharing `name` alone would send someone a street address
 * while the driver is reading "ENI Schottwien".
 */
const placeLabel = (c: Pick<Charger, 'name' | 'notes'>): string => c.notes || c.name

/**
 * Unlabelled, because Google has no supported way to name a pin at a
 * coordinate. Measured against the live client: `?q=lat,lon(Name)` drops the
 * parenthesised name, and `/maps/place/Name/@lat,lon` geocodes the _name_ and
 * moved the pin ~9 km off the coordinates it was given. `query_place_id` does
 * label a pin and needs a billed Places API id, which this app has no key for.
 * So the station travels in the share text; see `stationShare`.
 */
export function googlePlaceUrl(c: Pick<Charger, 'lat' | 'lon'>): string {
  const params = new URLSearchParams({ api: '1', query: `${c.lat},${c.lon}` })
  return `https://www.google.com/maps/search/?${params.toString()}`
}

/**
 * Apple's unified place URL (iOS 18.4+, macOS 15.4+), which does take a label:
 * `name` is documented as "a custom name to use for the place card". No
 * `address`, though `/place` accepts one — Apple reverse-geocodes it from
 * `coordinate` unprompted, and the share text carries it anyway.
 *
 * The older `?ll=&q=` form reaches iOS below 18.4 and Apple's servers rewrite
 * it into this URL, but that rewrite is not something they promise.
 */
export function applePlaceUrl(c: Pick<Charger, 'lat' | 'lon' | 'name' | 'notes'>): string {
  const params = new URLSearchParams({
    coordinate: `${c.lat},${c.lon}`,
    name: placeLabel(c),
  })
  return `https://maps.apple.com/place?${params.toString()}`
}

/**
 * What the share sheet hands to the target app.
 *
 * `text` names the station because the Google link cannot: for that provider
 * the message body is the only place the recipient learns which station this
 * is. No availability figures — "4 von 8 frei" is already wrong by the time the
 * message is read, and a shared link outlives a Refresh in a way the badge in
 * the app does not.
 */
export function stationShare(
  charger: Pick<Charger, 'lat' | 'lon' | 'name' | 'notes' | 'address'>,
  provider: PlaceProvider,
): ShareData {
  const label = placeLabel(charger)
  return {
    title: label,
    text: charger.address ? `${label}, ${charger.address}` : label,
    url: provider === 'apple' ? applePlaceUrl(charger) : googlePlaceUrl(charger),
  }
}
