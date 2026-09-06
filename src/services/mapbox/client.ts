import type { LatLon } from '../../core/types'

/**
 * The one place that holds the Mapbox token and turns a URL into JSON.
 *
 * The `pk.` token is public by design and safe in the bundle — restrict it to
 * your origins in the Mapbox dashboard. Only the EnBW calls need the Worker
 * (see services/enbw/availability.ts).
 */

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

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

export function requireToken(): string {
  if (isPlaceholderToken(TOKEN)) {
    throw new MapboxError(
      'VITE_MAPBOX_TOKEN is not set. Copy .env.example to .env and add your Mapbox public token (starts with "pk.").',
    )
  }
  return TOKEN as string
}

/** Null rather than throwing, for callers that can degrade instead of failing. */
export const optionalToken = (): string | null =>
  isPlaceholderToken(TOKEN) ? null : (TOKEN as string)

/** Mapbox URLs order coordinates lon,lat — the GeoJSON order, not the spoken one. */
export const coordPair = (p: LatLon): string => `${p.lon},${p.lat}`

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new MapboxError(`Mapbox ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}
