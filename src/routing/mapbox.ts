import type { LatLon } from '../providers/types'
import type { Route } from './corridor'

/**
 * Mapbox wrappers.
 *
 * The `pk.` token is public by design and safe in the bundle — restrict it to
 * your origins in the Mapbox dashboard. Only the EnBW calls need the Worker.
 */

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

/** Matrix caps at 25 coordinates per request on the `driving` profile. */
export const MATRIX_MAX_COORDS = 25

export class MapboxError extends Error {}

/**
 * A token left at the .env.example placeholder would otherwise surface as an
 * opaque Mapbox 401, which reads like a broken app rather than missing setup.
 */
export function isPlaceholderToken(token: string | undefined): boolean {
  if (!token) return true
  const t = token.trim()
  return t === '' || !t.startsWith('pk.') || /^pk\.x+$/i.test(t)
}

function requireToken(): string {
  if (isPlaceholderToken(TOKEN)) {
    throw new MapboxError(
      'VITE_MAPBOX_TOKEN is not set. Copy .env.example to .env and add your Mapbox public token (starts with "pk.").',
    )
  }
  return TOKEN as string
}

const coordPair = (p: LatLon) => `${p.lon},${p.lat}`

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new MapboxError(`Mapbox ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ *
 * Geocoding
 * ------------------------------------------------------------------ */

export interface Place {
  id: string
  name: string
  /** Full formatted address, for the second line in the picker. */
  context: string
  lat: number
  lon: number
}

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

/* ------------------------------------------------------------------ *
 * Directions
 * ------------------------------------------------------------------ */

interface DirectionsResponse {
  code?: string
  message?: string
  routes: {
    distance: number
    duration: number
    geometry: { coordinates: [number, number][] }
    legs: { annotation?: { distance?: number[]; duration?: number[] } }[]
  }[]
}

/**
 * The through-route from origin to destination.
 *
 * `driving-traffic` gives a realistic ETA for the headline route. The per-
 * segment annotations are what make the along-route distance/time columns free
 * — see routing/corridor.ts.
 */
export async function fetchRoute(
  origin: LatLon,
  destination: LatLon,
  signal?: AbortSignal,
): Promise<Route> {
  const path = `${coordPair(origin)};${coordPair(destination)}`
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${encodeURIComponent(path)}`,
  )
  url.searchParams.set('access_token', requireToken())
  url.searchParams.set('geometries', 'geojson')
  url.searchParams.set('overview', 'full')
  url.searchParams.set('annotations', 'distance,duration')
  url.searchParams.set('steps', 'false')

  const body = await getJson<DirectionsResponse>(url.toString(), signal)
  const route = body.routes?.[0]
  if (!route) {
    throw new MapboxError(body.message ?? 'No route found between those two points.')
  }

  // Annotations come per leg; with a single destination there is exactly one.
  const distances = route.legs.flatMap((l) => l.annotation?.distance ?? [])
  const durations = route.legs.flatMap((l) => l.annotation?.duration ?? [])

  return {
    coordinates: route.geometry.coordinates,
    distances,
    durations,
    totalDistanceM: route.distance,
    totalDurationS: route.duration,
  }
}

/* ------------------------------------------------------------------ *
 * Matrix
 * ------------------------------------------------------------------ */

interface MatrixResponse {
  code?: string
  message?: string
  /** [source][destination], seconds. null where no route exists. */
  durations: (number | null)[][] | null
}

export interface MatrixQuery {
  coordinates: LatLon[]
  sources: number[]
  destinations: number[]
}

/**
 * Duration matrix on the `driving` profile.
 *
 * Deliberately not `driving-traffic`: that profile caps at 10 coordinates
 * instead of 25, which would roughly triple the request count for the same set
 * of chargers. The headline route still uses traffic.
 */
export async function fetchMatrix(query: MatrixQuery, signal?: AbortSignal): Promise<(number | null)[][]> {
  const { coordinates, sources, destinations } = query
  if (coordinates.length > MATRIX_MAX_COORDS) {
    throw new MapboxError(
      `Matrix accepts at most ${MATRIX_MAX_COORDS} coordinates, got ${coordinates.length}`,
    )
  }
  if (coordinates.length < 2) throw new MapboxError('Matrix needs at least 2 coordinates')

  const path = coordinates.map(coordPair).join(';')
  const url = new URL(
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${encodeURIComponent(path)}`,
  )
  url.searchParams.set('access_token', requireToken())
  url.searchParams.set('annotations', 'duration')
  url.searchParams.set('sources', sources.join(';'))
  url.searchParams.set('destinations', destinations.join(';'))

  const body = await getJson<MatrixResponse>(url.toString(), signal)
  if (!body.durations) throw new MapboxError(body.message ?? 'Matrix returned no durations')
  return body.durations
}
