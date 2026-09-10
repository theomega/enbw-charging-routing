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
 * Occupancy is one Worker request per row, fanned out from the browser, so
 * nothing on the platform side caps this any more: the free plan's 50
 * subrequests are counted per invocation, and each row is now its own
 * invocation spending one. What is left is a budget question — the free plan
 * allows 100,000 Worker requests a day, and every search and every Refresh
 * spends this many of them — plus not hammering an undocumented upstream.
 * Detour is far cheaper: two Mapbox Matrix requests per 23 rows, so 45 rows
 * cost four.
 *
 * Because the list is in route order, these are exactly the next 45 stations
 * you will reach. That matters more than it sounds: the shipped list is dense
 * around cities, so a smaller limit is spent entirely on the town you are
 * leaving and never reaches the motorway you will actually charge on.
 */
export const ENRICHED_LIMIT = 45

export interface RouteSearch {
  status: SearchStatus
  error: string | null
  /** Every way Mapbox will get you there; often just one. */
  routes: RouteOption[]
  selected: RouteOption | null
  /**
   * The origin the routes and every along-route figure were actually measured
   * from. It lags live GPS by up to `ROUTE_REFRESH_DISTANCE_M`, so anything
   * rendered as "from you" must say which of the two it means.
   */
  anchor: LatLon | null
  selectRoute: (id: string) => void
  results: ChargerOnRoute[]
  /**
   * The rows the pipeline looks up live data for — the first `ENRICHED_LIMIT`.
   * Anything outside this set has to fetch its own if it is ever opened, and
   * anything inside it must not, or opening a row before its lookup lands would
   * spend a second request on the station already in flight.
   */
  enrichedIds: ReadonlySet<string>
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

  const {
    routes,
    selected,
    selectRoute,
    anchor,
    loading: routing,
    error: routeError,
  } = useRoutes(origin, destination)

  const corridor = useCorridor(selected, DEFAULT_MAX_OFFSET_M)

  // Filtering is derived, so toggling a setting is instant and free.
  const filtered = useMemo(
    () => applyStaticFilters(corridor.placed, settings),
    [corridor.placed, settings],
  )

  // Memoised, not sliced inline: these arrays are effect inputs, and a fresh
  // identity every render would re-fetch occupancy forever.
  const enriched = useMemo(() => filtered.slice(0, ENRICHED_LIMIT), [filtered])
  const enrichedIds = useMemo(() => new Set(enriched.map((c) => c.charger.id)), [enriched])

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
      const priced = detours[c.charger.id]
      return {
        ...c,
        charger: occupancy ? { ...c.charger, ...occupancy } : c.charger,
        ...(priced ?? {}),
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
    anchor,
    results,
    enrichedIds,
    unfilteredCount: corridor.placed.length,
    progress: corridor.progress,
    fetchedAt,
    refresh,
  }
}
