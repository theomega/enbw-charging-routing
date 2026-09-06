import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_MAX_OFFSET_M } from '../core/corridor'
import { applyLiveFilters, applyStaticFilters } from '../core/filters'
import type { ChargerOnRoute, LatLon, Place } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { useAppStore } from '../state/store'
import { useAvailability } from './useAvailability'
import { useCorridor } from './useCorridor'
import { useDetours } from './useDetours'
import { useRoutes } from './useRoutes'

/**
 * The whole search, in one place and in reading order:
 *
 *   route  ->  place the shipped stations on it  ->  filter
 *          ->  enrich the visible rows (occupancy, detour)  ->  filter again
 *
 * Each step is its own hook, so the expensive ones can be read, tested and
 * reasoned about separately; this file is the pipeline and nothing else.
 */

export type SearchStatus = 'idle' | 'routing' | 'placing' | 'pricing' | 'ready' | 'error'

/**
 * How many of the nearest candidates are enriched with live data.
 *
 * Occupancy and detour share the limit so the same rows carry both numbers.
 * Occupancy costs roughly this many upstream requests, minus whatever merges
 * geographically; detour costs two Mapbox Matrix requests per 23 rows.
 *
 * Because the list is in route order, these are exactly the next 20 stations
 * you will reach.
 */
export const ENRICHED_LIMIT = 20

export interface RouteSearch {
  status: SearchStatus
  error: string | null
  /** Every way Mapbox will get you there; often just one. */
  routes: RouteOption[]
  selected: RouteOption | null
  selectRoute: (id: string) => void
  results: ChargerOnRoute[]
  /** Corridor chargers before the power filter, for the "widen" hint. */
  unfilteredCount: number
  /** 0..1 while the corridor is being placed, null otherwise. */
  progress: number | null
  fetchedAt: Date | null
  /** Re-fetch occupancy only. Never re-routes and never reloads the list. */
  refresh: () => void
}

export function useRouteSearch(origin: LatLon | null, destination: Place | null): RouteSearch {
  const settings = useAppStore((s) => s.settings)
  const [nonce, setNonce] = useState(0)

  const { routes, selected, selectRoute, anchor, loading: routing, error: routeError } =
    useRoutes(origin, destination)

  const corridor = useCorridor(selected, DEFAULT_MAX_OFFSET_M)

  // Filtering is derived, so toggling a setting is instant and free.
  const filtered = useMemo(
    () => applyStaticFilters(corridor.placed, settings),
    [corridor.placed, settings],
  )

  // Memoised, not sliced inline: these arrays are effect inputs, and a fresh
  // identity every render would re-fetch occupancy forever.
  const enriched = useMemo(() => filtered.slice(0, ENRICHED_LIMIT), [filtered])

  const { live, fetchedAt } = useAvailability(enriched, nonce)
  const { detours, pricing } = useDetours(
    anchor,
    destination,
    selected,
    routes,
    filtered,
    ENRICHED_LIMIT,
  )

  const results = useMemo(() => {
    const merged = filtered.map((c) => {
      // The shipped list already describes the station completely — name,
      // address, power, point count, operator. The live record is occupancy
      // only, so spreading it can add numbers but can never take identity away.
      // A station still waiting for it, or one whose id EnBW has re-issued,
      // keeps `availablePoints: null` and renders as "?/n" rather than "0/n".
      const occupancy = live.get(c.charger.id)
      return {
        ...c,
        charger: occupancy ? { ...c.charger, ...occupancy } : c.charger,
        detourS: c.charger.id in detours ? detours[c.charger.id] : c.detourS,
      }
    })
    // No sorting here. The corridor already emits route order and nothing
    // downstream re-orders: chargers are always listed in the order you drive
    // past them.
    return applyLiveFilters(merged, settings)
  }, [filtered, live, detours, settings])

  // Only occupancy is refreshed. The route and the station list are unchanged,
  // and re-fetching either would spend Mapbox quota for nothing.
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  const error = routeError ?? corridor.error
  const status: SearchStatus = error
    ? 'error'
    : !origin || !destination
      ? 'idle'
      : routing
        ? 'routing'
        : corridor.working
          ? 'placing'
          : pricing
            ? 'pricing'
            : 'ready'

  return {
    status,
    error,
    routes,
    selected,
    selectRoute,
    results,
    unfilteredCount: corridor.placed.length,
    progress: corridor.progress,
    fetchedAt,
    refresh,
  }
}
