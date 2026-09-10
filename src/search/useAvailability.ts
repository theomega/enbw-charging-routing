import { useEffect, useState } from 'react'
import type { ChargerOnRoute } from '../core/types'
import { fetchAvailability, type LiveStation } from '../services/enbw/availability'

export interface LiveAvailability {
  /** Live fields by charger id, to merge over the shipped station. */
  live: Map<string, LiveStation>
  fetchedAt: Date | null
}

/**
 * The live record for the rows actually on screen — one request per station.
 *
 * This is the only EnBW traffic the app makes. It answers how busy each station
 * is and what its points, plugs and tariff are; identity — name, address, power,
 * point count — comes from the shipped list either way. So a failure here costs
 * the badge and the detail panel's extras, never the row itself. That is why it
 * is logged rather than surfaced: blanking the list would be far worse than
 * showing "?/n".
 */
export function useAvailability(candidates: ChargerOnRoute[], nonce: number): LiveAvailability {
  const [live, setLive] = useState<Map<string, LiveStation>>(new Map())
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (candidates.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        const result = await fetchAvailability(
          candidates.map((c) => c.charger),
          { signal: controller.signal },
        )
        if (cancelled) return
        setLive(result.live)
        setFetchedAt(new Date())
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        console.warn('Availability lookup failed:', err)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [candidates, nonce])

  return { live, fetchedAt }
}
