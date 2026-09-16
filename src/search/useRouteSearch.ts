import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_MAX_OFFSET_M } from '../core/corridor'
import { applyLiveFilters, applyStaticFilters } from '../core/filters'
import { aheadOfDriver, isOffRoute, remainingRoute, type RouteProgress } from '../core/progress'
import type { ChargerOnRoute, LatLon, Place } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { useAppStore } from '../state/store'
import { useAvailability } from './useAvailability'
import { useCorridor } from './useCorridor'
import { useDetours } from './useDetours'
import { useRouteProgress } from './useRouteProgress'
import { useRoutes } from './useRoutes'
import { useSteppedOrigin } from './useSteppedOrigin'

/**
 * The whole search, in one place and in reading order:
 *
 *   route  ->  place the shipped stations on it  ->  drop what is behind you
 *          ->  filter  ->  enrich the visible rows  ->  filter again
 *
 * Each step is its own hook, so the expensive ones can be read, tested and
 * reasoned about separately; this file is the pipeline and nothing else.
 *
 * The route is fetched once per journey and never re-fetched as the driver
 * moves (`useRoutes`). "Drop what is behind you" is therefore where the drive
 * enters the pipeline: `useRouteProgress` projects the live position onto the
 * fixed route, and `aheadOfDriver` both removes the stations already passed and
 * re-measures the rest from the driver instead of from the route's start.
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
 * Detour is far cheaper: two Mapbox Matrix requests per 12 rows, so 45 rows
 * cost eight.
 *
 * Because the list is in route order and starts at the driver, these are
 * exactly the next 45 stations they will reach. That matters more than it
 * sounds: the shipped list is dense around cities, so a smaller limit is spent
 * entirely on the town being left and never reaches the motorway the driver
 * will actually charge on.
 */
export const ENRICHED_LIMIT = 45

export interface RouteSearch {
  status: SearchStatus
  error: string | null
  /** Every way Mapbox will get you there; often just one. */
  routes: RouteOption[]
  selected: RouteOption | null
  selectRoute: (id: string) => void
  /**
   * Where the driver is on the selected route. Null before the first fix or
   * before a route exists.
   */
  progress: RouteProgress | null
  /**
   * What is left of the journey from the driver's position — not the route's
   * totals, which are measured from wherever it was built.
   */
  remaining: { distanceM: number; durationS: number } | null
  /**
   * The driver is far enough off the line that the route no longer describes
   * the drive. Never acted on automatically: driving to a charger is a
   * deviation too, and re-routing under a driver standing at one would empty
   * the list they are reading.
   */
  offRoute: boolean
  /** Route again from the live position. What the deviation offer calls. */
  reroute: () => void
  results: ChargerOnRoute[]
  /**
   * The rows the pipeline looks up live data for — the first `ENRICHED_LIMIT`.
   * Anything outside this set has to fetch its own if it is ever opened, and
   * anything inside it must not, or opening a row before its lookup lands would
   * spend a second request on the station already in flight.
   */
  enrichedIds: ReadonlySet<string>
  /** Stations ahead before the power filter, for the "widen" hint. */
  unfilteredCount: number
  /** 0..1 while the corridor is being placed, null otherwise. */
  progressFraction: number | null
  fetchedAt: Date | null
  /**
   * Rows whose occupancy lookup is in flight. They still carry their last
   * measured numbers, so this is what marks them as being re-read rather than
   * as unknown.
   */
  refreshingIds: ReadonlySet<string>
  /**
   * Re-read what changes with time: occupancy, and the route's traffic. Never
   * re-routes — `directionsRefresh` replaces the annotations on the route we
   * already have — so the driver's chosen alternative and the station list both
   * survive it.
   */
  refresh: () => void
  /**
   * Bumped by `refresh`. Rows outside `enrichedIds` hold their own live record
   * and are not part of the pipeline's fan-out, so this is how they learn that
   * a refresh happened and that theirs is now the only stale number on screen.
   */
  refreshNonce: number
}

export function useRouteSearch(position: LatLon | null, destination: Place | null): RouteSearch {
  const settings = useAppStore((s) => s.settings)
  const [nonce, setNonce] = useState(0)

  const {
    routes,
    selected,
    selectRoute,
    loading: routing,
    error: routeError,
    reroute,
    refreshTraffic,
  } = useRoutes(position, destination)

  const progress = useRouteProgress(selected, position)
  const corridor = useCorridor(selected, DEFAULT_MAX_OFFSET_M)

  // Where the drive enters the pipeline. Before the power filter, so the
  // "widen your filters" hint counts stations that are actually still ahead.
  const ahead = useMemo(
    () =>
      progress && position ? aheadOfDriver(corridor.placed, progress, position) : corridor.placed,
    [corridor.placed, progress, position],
  )

  // Filtering is derived, so toggling a setting is instant and free.
  const filtered = useMemo(() => applyStaticFilters(ahead, settings), [ahead, settings])

  const enriched = useMemo(() => filtered.slice(0, ENRICHED_LIMIT), [filtered])
  const enrichedIds = useMemo(() => new Set(enriched.map((c) => c.charger.id)), [enriched])

  const { live, fetchedAt, pending } = useAvailability(enriched, nonce)

  // Stepped, not live: `detourCacheKey` rounds an origin to ~111 m, so pricing
  // from the live position would miss the cache every hundred metres.
  const matrixOrigin = useSteppedOrigin(position)
  const { detours, pricing } = useDetours(
    matrixOrigin,
    destination,
    selected,
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

  const refresh = useCallback(() => {
    setNonce((n) => n + 1)
    refreshTraffic()
  }, [refreshTraffic])

  const error = routeError ?? corridor.error
  const status: SearchStatus = error
    ? 'error'
    : !position || !destination
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
    progress,
    remaining: selected && progress ? remainingRoute(selected.route, progress) : null,
    // Only meaningful once a route exists and is not being replaced.
    offRoute: !!progress && !routing && !!selected && isOffRoute(progress),
    reroute,
    results,
    enrichedIds,
    unfilteredCount: ahead.length,
    progressFraction: corridor.progress,
    fetchedAt,
    refreshingIds: pending,
    refresh,
    refreshNonce: nonce,
  }
}
