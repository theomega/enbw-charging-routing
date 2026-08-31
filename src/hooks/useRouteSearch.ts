import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { enbwProvider, matchesProviderFilter } from '../providers/enbw'
import type { Charger, ChargerOnRoute, LatLon } from '../providers/types'
import {
  buildRouteIndex,
  placeChargersOnRoute,
  tilesForRoute,
  type Route,
} from '../routing/corridor'
import { DetourCache, priceDetours } from '../routing/detour'
import { fetchRoute, type Place } from '../routing/mapbox'
import { useAppStore, type Settings } from '../state/store'

export type SearchStatus = 'idle' | 'routing' | 'scanning' | 'pricing' | 'ready' | 'error'

/** How far the origin must move before the route is worth recomputing. */
const ROUTE_REFRESH_DISTANCE_M = 2_000
/** Detour is priced for this many of the nearest candidates. */
const PRICED_LIMIT = 20

export interface RouteSearch {
  status: SearchStatus
  error: string | null
  route: Route | null
  results: ChargerOnRoute[]
  /** Corridor chargers before the provider/power filters, for the "widen" hint. */
  unfilteredCount: number
  fetchedAt: Date | null
  refresh: () => void
}

export function useRouteSearch(origin: LatLon | null, destination: Place | null): RouteSearch {
  const settings = useAppStore((s) => s.settings)

  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [placed, setPlaced] = useState<ChargerOnRoute[]>([])
  const [detours, setDetours] = useState<Record<string, number | null>>({})
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [nonce, setNonce] = useState(0)

  const detourCache = useRef(new DetourCache())
  // The origin the current route was built from. Small GPS movements must not
  // retrigger a full route + corridor scan.
  const routeOriginRef = useRef<LatLon | null>(null)

  const stableOrigin = useMemo(() => {
    const anchor = routeOriginRef.current
    if (origin && anchor && roughMetres(anchor, origin) < ROUTE_REFRESH_DISTANCE_M) return anchor
    return origin
  }, [origin])

  const refresh = useCallback(() => {
    routeOriginRef.current = null
    setNonce((n) => n + 1)
  }, [])

  // Route + corridor scan. Deliberately does NOT depend on `settings`: changing
  // a filter must never re-spend Directions or EnBW requests.
  useEffect(() => {
    if (!stableOrigin || !destination) {
      setStatus('idle')
      setRoute(null)
      setPlaced([])
      return
    }

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        setError(null)
        setStatus('routing')
        const dest = { lat: destination.lat, lon: destination.lon }
        const fetched = await fetchRoute(stableOrigin, dest, controller.signal)
        if (cancelled) return
        routeOriginRef.current = stableOrigin
        setRoute(fetched)

        setStatus('scanning')
        const tiles = tilesForRoute(fetched)
        const chargers: Charger[] = await enbwProvider.fetchInTiles(tiles, controller.signal)
        if (cancelled) return

        const index = buildRouteIndex(fetched)
        setPlaced(placeChargersOnRoute(index, chargers))
        setFetchedAt(new Date())
        setStatus('ready')
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [stableOrigin, destination, nonce])

  // Filtering is derived, so toggling a setting is instant and free.
  const filtered = useMemo(() => applyFilters(placed, settings), [placed, settings])

  // Detour pricing follows the filtered set, backed by a cache so that flipping
  // filters back and forth does not re-spend matrix requests.
  useEffect(() => {
    const dest = destination ? { lat: destination.lat, lon: destination.lon } : null
    const anchor = routeOriginRef.current
    if (!anchor || !dest || filtered.length === 0) return

    const wanted = filtered.slice(0, PRICED_LIMIT)
    const cache = detourCache.current
    const cachedHits: Record<string, number | null> = {}
    const missing = wanted.filter((c) => {
      if (cache.has(anchor, dest, c.charger.id)) {
        cachedHits[c.charger.id] = cache.get(anchor, dest, c.charger.id) ?? null
        return false
      }
      return true
    })

    if (Object.keys(cachedHits).length > 0) setDetours((d) => ({ ...d, ...cachedHits }))
    if (missing.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        setStatus((s) => (s === 'ready' ? 'pricing' : s))
        const priced = await priceDetours(anchor, dest, missing, {
          limit: missing.length,
          signal: controller.signal,
        })
        if (cancelled) return
        const next: Record<string, number | null> = {}
        for (const p of priced) {
          cache.set(anchor, dest, p.charger.id, p.detourS)
          next[p.charger.id] = p.detourS
        }
        setDetours((d) => ({ ...d, ...next }))
        setStatus((s) => (s === 'pricing' ? 'ready' : s))
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        // A failed detour lookup must not blank the list — the distance and
        // availability columns are still perfectly useful without it.
        console.warn('Detour pricing failed:', err)
        setStatus((s) => (s === 'pricing' ? 'ready' : s))
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [filtered, destination])

  const results = useMemo(() => {
    const withDetours = filtered.map((c) =>
      c.charger.id in detours ? { ...c, detourS: detours[c.charger.id] } : c,
    )
    // No sorting here: `placed` already comes out of placeChargersOnRoute in
    // route order, and filtering preserves it. Chargers are always listed in
    // the order you drive past them.
    return settings.maxDetourMinutes == null
      ? withDetours
      : withDetours.filter(
          (c) => c.detourS == null || c.detourS <= settings.maxDetourMinutes! * 60,
        )
  }, [filtered, detours, settings.maxDetourMinutes])

  return {
    status,
    error,
    route,
    results,
    unfilteredCount: placed.length,
    fetchedAt,
    refresh,
  }
}

export function applyFilters(items: ChargerOnRoute[], settings: Settings): ChargerOnRoute[] {
  return items.filter(({ charger }) => {
    if (!matchesProviderFilter(charger, settings.providerFilter)) return false
    if (settings.minPowerKw > 0) {
      // Unknown power is kept rather than guessed at; the badge shows "? kW".
      if (charger.maxPowerKw != null && charger.maxPowerKw < settings.minPowerKw) return false
    }
    if (settings.hideFullStations && charger.availablePoints === 0) return false
    return true
  })
}

function roughMetres(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * 111_320
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}
