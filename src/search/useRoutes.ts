import { useCallback, useEffect, useMemo, useState } from 'react'
import { distanceM } from '../core/geo'
import type { LatLon, Place } from '../core/types'
import { fetchRoutes, type RouteOption } from '../services/mapbox/directions'

/** How far the origin must move before the route is worth recomputing. */
export const ROUTE_REFRESH_DISTANCE_M = 2_000

export interface Routes {
  routes: RouteOption[]
  selected: RouteOption | null
  selectRoute: (id: string) => void
  /**
   * The origin the current routes were actually built from. Everything priced
   * against these routes must use this, not the live GPS position, or the
   * detour maths would be measuring from a point the route does not start at.
   */
  anchor: LatLon | null
  loading: boolean
  error: string | null
}

/**
 * Fetch every route Mapbox will offer, and remember which one is selected.
 *
 * Deliberately independent of settings and of the charger list: neither should
 * ever re-spend a Directions request. It is also deliberately insensitive to
 * small movements — a GPS watch ticks every few metres, and re-routing on each
 * tick would burn quota to redraw the same line.
 */
export function useRoutes(origin: LatLon | null, destination: Place | null): Routes {
  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<LatLon | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Snap back to the existing anchor while the user has barely moved, so the
  // effect below sees an unchanged input and does nothing.
  const target = useMemo(() => {
    if (origin && anchor && distanceM(anchor, origin) < ROUTE_REFRESH_DISTANCE_M) return anchor
    return origin
  }, [origin, anchor])

  useEffect(() => {
    if (!target || !destination) {
      setRoutes([])
      setSelectedId(null)
      setAnchor(null)
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
          target,
          { lat: destination.lat, lon: destination.lon },
          controller.signal,
        )
        if (cancelled) return
        setRoutes(fetched)
        // Mapbox orders by descending recommendation rank, so [0] is the pick.
        setSelectedId(fetched[0]?.id ?? null)
        setAnchor(target)
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
  }, [target, destination])

  const selected = useMemo(
    () => routes.find((r) => r.id === selectedId) ?? routes[0] ?? null,
    [routes, selectedId],
  )

  const selectRoute = useCallback((id: string) => setSelectedId(id), [])

  return { routes, selected, selectRoute, anchor, loading, error }
}
