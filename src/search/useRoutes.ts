import { useCallback, useEffect, useRef, useState } from 'react'
import type { LatLon, Place } from '../core/types'
import { fetchRoutes, type RouteOption } from '../services/mapbox/directions'
import { fetchRouteRefresh } from '../services/mapbox/directionsRefresh'

export interface Routes {
  routes: RouteOption[]
  selected: RouteOption | null
  selectRoute: (id: string) => void
  /**
   * The origin the route was built from — the driver's position when the
   * journey started, or when they last accepted a re-route. Fixed for the
   * journey, which is what makes the route object stable; where the driver is
   * *now* is `useRouteProgress`, measured against this same route.
   */
  routeOrigin: LatLon | null
  loading: boolean
  error: string | null
  /** Route again from the live position. Offered on deviation, never automatic. */
  reroute: () => void
  /** Re-read traffic on the selected route. Falls back to `reroute` if refused. */
  refreshTraffic: () => void
}

/**
 * One route per journey.
 *
 * This used to refetch every two kilometres, purely so that "distance from the
 * route start" would keep meaning "distance from you". `core/progress.ts` now
 * answers that locally, and dropping the refetch takes four problems with it:
 * the list no longer unmounts mid-drive, the placement cache stops missing, the
 * ETA no longer needs a whole new route to stay current, and the driver's
 * choice of alternative survives — the old code reset it to Mapbox's first
 * recommendation on every refetch, silently putting a driver who had chosen the
 * Jaufenpass back on the Brenner.
 *
 * So there are exactly three reasons to spend a Directions request now: a new
 * destination, the first fix of a journey, and a deviation the driver has
 * explicitly accepted.
 */
export function useRoutes(position: LatLon | null, destination: Place | null): Routes {
  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [routeOrigin, setRouteOrigin] = useState<LatLon | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * The origin to route from. Setting it is the only thing that spends a
   * Directions request, so every trigger below funnels through it.
   */
  const [origin, setOrigin] = useState<LatLon | null>(null)

  // The live position, for the callbacks. Deliberately a ref: making it a
  // dependency is what used to re-route the drive.
  const positionRef = useRef(position)
  positionRef.current = position

  const selected = routes.find((r) => r.id === selectedId) ?? routes[0] ?? null
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // A new destination is a new journey. Cleared here rather than when the new
  // route lands, so nothing on screen — neither the map's line nor the station
  // list — ever belongs to a destination the driver is no longer driving to.
  useEffect(() => {
    setRoutes([])
    setSelectedId(null)
    setRouteOrigin(null)
    setOrigin(null)
    setError(null)
  }, [destination])

  // The first fix of the journey. Later ticks are ignored: `origin` is set, and
  // that is the whole point.
  useEffect(() => {
    if (origin || !position) return
    setOrigin(position)
  }, [origin, position])

  const reroute = useCallback(() => {
    const now = positionRef.current
    if (now) setOrigin(now)
  }, [])

  useEffect(() => {
    if (!origin || !destination) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        setError(null)
        setLoading(true)
        const fetched = await fetchRoutes(
          origin,
          { lat: destination.lat, lon: destination.lon },
          controller.signal,
        )
        if (cancelled) return
        setRoutes(fetched)
        // Mapbox orders by descending recommendation rank, so [0] is the pick.
        // Safe to reset now in a way it never was before: this only runs for a
        // new journey or a re-route the driver asked for, never behind their
        // back while driving.
        setSelectedId(fetched[0]?.id ?? null)
        setRouteOrigin(origin)
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [origin, destination])

  /**
   * Traffic only: same route, same id, fresh annotations.
   *
   * Replaced by identity rather than mutated, so `useRouteProgress` rebuilds
   * its prefix sums and `useCorridor` re-places the stations against the new
   * times — the two things that would otherwise go on reporting the traffic of
   * an hour ago. The id is deliberately unchanged, so the detour cache, which
   * prices geometry and does not care about traffic, survives it.
   *
   * A refusal falls through to a full re-route. The `uuid`'s refreshable
   * lifetime is undocumented, so "this no longer works" is an expected answer
   * and the wrong response to it is to keep the stale numbers.
   */
  const refreshTraffic = useCallback(() => {
    const option = selectedRef.current
    if (!option) return
    if (!option.uuid) {
      reroute()
      return
    }
    void (async () => {
      let next: RouteOption | null = null
      try {
        next = await fetchRouteRefresh(option)
      } catch {
        next = null
      }
      if (!next) {
        reroute()
        return
      }
      const fresh = next
      setRoutes((current) => current.map((r) => (r.id === fresh.id ? fresh : r)))
    })()
  }, [reroute])

  const selectRoute = useCallback((id: string) => setSelectedId(id), [])

  return { routes, selected, selectRoute, routeOrigin, loading, error, reroute, refreshTraffic }
}
