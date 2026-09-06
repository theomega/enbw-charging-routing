import { useEffect, useState } from 'react'
import type { ChargerOnRoute } from '../core/types'
import { fetchAvailability, type Occupancy } from '../services/enbw/availability'

export interface LiveAvailability {
  /** Occupancy by charger id, to merge over the shipped station. */
  live: Map<string, Occupancy>
  fetchedAt: Date | null
}

/**
 * Live occupancy for the rows actually on screen — one request per station.
 *
 * This is the only EnBW traffic the app makes, and the only thing it asks for
 * is how busy each station is right now. Everything else on the card comes from
 * the shipped list, so a failure here costs the badge and nothing more. That is
 * why it is logged rather than surfaced: blanking the list would be far worse
 * than showing "?/n".
 */
export function useAvailability(candidates: ChargerOnRoute[], nonce: number): LiveAvailability {
  const [live, setLive] = useState<Map<string, Occupancy>>(new Map())
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
