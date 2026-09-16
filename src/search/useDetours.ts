import { useEffect, useRef, useState } from 'react'
import { DetourCache, priceDetours, type Pricing } from '../core/detour'
import type { ChargerOnRoute, LatLon, Place } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { fetchMatrix } from '../services/mapbox/matrix'

export interface PricedDetours {
  /**
   * Detour and the two driving legs, by charger id. Absent for rows past the
   * limit; present with null members where Mapbox could not route to the point.
   */
  detours: Record<string, Pricing>
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
 *
 * Keyed on *which* stations are wanted rather than on the array holding them,
 * for the reason `useAvailability` is: the candidate list is rebuilt on every
 * GPS tick as its along-route figures count down, and re-running this per tick
 * would churn through the cache and `setDetours` several times a minute for
 * numbers that never changed. The origin is `useSteppedOrigin`, which is what
 * actually decides when a re-price is due.
 */
export function useDetours(
  origin: LatLon | null,
  destination: Place | null,
  selected: RouteOption | null,
  candidates: ChargerOnRoute[],
  limit: number,
): PricedDetours {
  const [detours, setDetours] = useState<Record<string, Pricing>>({})
  const [pricing, setPricing] = useState(false)
  const cache = useRef(new DetourCache())

  // The effect's real inputs; see the note above.
  const membership = candidates
    .slice(0, limit)
    .map((c) => c.charger.id)
    .join(',')
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates

  useEffect(() => {
    const candidates = candidatesRef.current
    const dest = destination ? { lat: destination.lat, lon: destination.lon } : null
    if (!origin || !dest || candidates.length === 0) return

    const wanted = candidates.slice(0, limit)
    // Each candidate carries the route point it was placed against, so the
    // same charger on a different alternative is a different measurement — the
    // cache key must say which route produced it. On a stretch two routes share
    // the two entries now agree to the second, but they are still two entries.
    const keyOf = (chargerId: string) => `${selected?.id ?? ''}|${chargerId}`

    const hits: Record<string, Pricing> = {}
    const missing = wanted.filter((c) => {
      const key = keyOf(c.charger.id)
      const cached = cache.current.get(origin, dest, key)
      if (!cached) return true
      hits[c.charger.id] = cached
      return false
    })

    if (Object.keys(hits).length > 0) setDetours((d) => ({ ...d, ...hits }))
    if (missing.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        setPricing(true)
        const priced = await priceDetours(origin, dest, missing, {
          matrix: fetchMatrix,
          limit: missing.length,
          signal: controller.signal,
        })
        if (cancelled) return

        const next: Record<string, Pricing> = {}
        for (const p of priced) {
          const entry: Pricing = {
            detourS: p.detourS,
            detourM: p.detourM,
            legs: p.legs ?? {
              toChargerM: null,
              toChargerS: null,
              fromChargerM: null,
              fromChargerS: null,
            },
          }
          cache.current.set(origin, dest, keyOf(p.charger.id), entry)
          next[p.charger.id] = entry
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
  }, [origin, destination, selected, membership, limit])

  return { detours, pricing }
}
