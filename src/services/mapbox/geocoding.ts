import type { LatLon, Place } from '../../core/types'
import { coordPair, getJson, requireToken } from './client'

/** Destination search: Mapbox Geocoding v6, forward only. */

interface GeocodeResponse {
  features: {
    id: string
    properties: {
      mapbox_id?: string
      name?: string
      full_address?: string
      place_formatted?: string
      coordinates?: { longitude: number; latitude: number }
    }
    geometry: { coordinates: [number, number] }
  }[]
}

/**
 * Preferred label language, e.g. "de" from "de-DE". Only the primary subtag is
 * sent; Mapbox falls back to local names when it has no translation.
 */
export function preferredLanguage(tag?: string): string {
  const raw = tag ?? (typeof navigator !== 'undefined' ? navigator.language : '')
  const primary = raw?.split('-')[0]?.toLowerCase()
  return primary && /^[a-z]{2,3}$/.test(primary) ? primary : 'en'
}

/**
 * Build the forward-geocode URL.
 *
 * Deliberately NOT restricted by country. An earlier version pinned
 * `country=de`, which silently hid every destination abroad — a trip to South
 * Tyrol or Austria could not be entered at all. Relevance is steered by
 * `proximity` (your current position) instead, which biases without excluding.
 */
export function buildGeocodeUrl(
  query: string,
  proximity: LatLon | null,
  token: string,
  language = preferredLanguage(),
): string {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward')
  url.searchParams.set('q', query)
  url.searchParams.set('access_token', token)
  url.searchParams.set('language', language)
  url.searchParams.set('limit', '6')
  if (proximity) url.searchParams.set('proximity', coordPair(proximity))
  return url.toString()
}

/** Forward geocode, biased towards the user's current position. */
export async function geocode(
  query: string,
  proximity: LatLon | null,
  signal?: AbortSignal,
): Promise<Place[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const url = buildGeocodeUrl(trimmed, proximity, requireToken())

  const body = await getJson<GeocodeResponse>(url, signal)
  return body.features.map((f) => {
    const [lon, lat] = f.geometry.coordinates
    return {
      id: f.properties.mapbox_id ?? f.id,
      name: f.properties.name ?? f.properties.full_address ?? trimmed,
      context: f.properties.place_formatted ?? f.properties.full_address ?? '',
      lat,
      lon,
    }
  })
}
