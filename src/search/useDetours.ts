import { useEffect, useRef, useState } from 'react'
import { DetourCache, priceDetours, routePenaltySeconds } from '../core/detour'
import type { ChargerOnRoute, LatLon, Place } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { fetchMatrix } from '../services/mapbox/matrix'

export interface PricedDetours {
  /** Seconds by charger id; null where Mapbox could not route to the point. */
  detours: Record<string, number | null>
  pricing: boolean
}

/**
 * Price the detour for the candidates the user can actually see.
 *
 * The only part of the corridor that costs Mapbox quota, so it is cached hard:
 * detours depend on geometry alone, which means filter toggles and occupancy
 * refreshes must never re-spend a matrix request.
 *
 * As with availability, a failure is logged rather than surfaced — the list is
 * still useful with "—" in the detour column.
 */
export function useDetours(
  anchor: LatLon | null,
  destination: Place | null,
  selected: RouteOption | null,
  routes: RouteOption[],
  candidates: ChargerOnRoute[],
  limit: number,
): PricedDetours {
  const [detours, setDetours] = useState<Record<string, number | null>>({})
  const [pricing, setPricing] = useState(false)
  const cache = useRef(new DetourCache())

  useEffect(() => {
    const dest = destination ? { lat: destination.lat, lon: destination.lon } : null
    if (!anchor || !dest || candidates.length === 0) return

    const penaltyS = routePenaltySeconds(
      selected?.route.totalDurationS ?? 0,
      routes[0]?.route.totalDurationS ?? 0,
    )

    const wanted = candidates.slice(0, limit)
    // Detours are re-baselined per route, so the same charger has a different
    // value on a different alternative — the cache key must say which.
    const keyOf = (chargerId: string) => `${selected?.id ?? ''}|${chargerId}`

    const hits: Record<string, number | null> = {}
    const missing = wanted.filter((c) => {
      const key = keyOf(c.charger.id)
      if (!cache.current.has(anchor, dest, key)) return true
      hits[c.charger.id] = cache.current.get(anchor, dest, key) ?? null
      return false
    })

    if (Object.keys(hits).length > 0) setDetours((d) => ({ ...d, ...hits }))
    if (missing.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        setPricing(true)
        const priced = await priceDetours(anchor, dest, missing, {
          matrix: fetchMatrix,
          limit: missing.length,
          penaltyS,
          signal: controller.signal,
        })
        if (cancelled) return

        const next: Record<string, number | null> = {}
        for (const p of priced) {
          cache.current.set(anchor, dest, keyOf(p.charger.id), p.detourS)
          next[p.charger.id] = p.detourS
        }
        setDetours((d) => ({ ...d, ...next }))
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        console.warn('Detour pricing failed:', err)
      } finally {
        if (!cancelled) setPricing(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [anchor, destination, selected, routes, candidates, limit])

  return { detours, pricing }
}
