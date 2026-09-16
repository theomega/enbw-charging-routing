import { useEffect, useRef, useState } from 'react'
import type { ChargerOnRoute } from '../core/types'
import { fetchAvailability, type LiveStation } from '../services/enbw/availability'

export interface LiveAvailability {
  /** Live fields by charger id, to merge over the shipped station. */
  live: Map<string, LiveStation>
  fetchedAt: Date | null
  /**
   * Charger ids whose lookup is in flight right now. A row in here keeps
   * showing whatever it last measured — the previous numbers are still the best
   * answer available until the new ones land — and marks itself as being
   * re-read rather than blanking.
   */
  pending: ReadonlySet<string>
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
 *
 * Records are merged one at a time as they arrive rather than swapped in as a
 * batch at the end. Occupancy rarely changes between two refreshes a minute
 * apart, so a batch swap is invisible — the numbers are the same numbers — and
 * a driver pressing Refresh gets no evidence that anything happened at all.
 * Per-station arrival is what `pending` is for: each row can say it is being
 * re-read and stop saying so on its own answer, not on the slowest of 45.
 *
 * The lookup is keyed on *which* stations are wanted, not on the array holding
 * them. That distinction is load-bearing: the candidate list is rebuilt on
 * every GPS tick — its along-route figures count down as the driver approaches
 * — and on every settings change, so an array-identity dependency would fan
 * out 45 requests every fifty metres, and again for switching maps app. Only a
 * change of membership is a reason to ask EnBW anything.
 */
export function useAvailability(candidates: ChargerOnRoute[], nonce: number): LiveAvailability {
  const [live, setLive] = useState<Map<string, LiveStation>>(new Map())
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())

  // The effect's real input. Read through a ref so that rebuilding the array
  // around the same stations is not a reason to re-fetch them.
  const wanted = candidates.map((c) => c.charger.id).join(',')
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates

  useEffect(() => {
    const candidates = candidatesRef.current
    if (candidates.length === 0) return

    const controller = new AbortController()
    let cancelled = false

    setPending(new Set(candidates.map((c) => c.charger.id)))

    void (async () => {
      try {
        const result = await fetchAvailability(
          candidates.map((c) => c.charger),
          {
            signal: controller.signal,
            onStation: (chargerId, station) => {
              if (cancelled) return
              setLive((prev) => {
                const next = new Map(prev)
                // Deleted rather than left in place when a station does not
                // answer: an id EnBW has re-issued has to fall back to "?/n",
                // and a stale count from ten minutes ago must not pose as a
                // fresh one.
                if (station) next.set(chargerId, station)
                else next.delete(chargerId)
                return next
              })
              setPending((prev) => {
                const next = new Set(prev)
                next.delete(chargerId)
                return next
              })
            },
          },
        )
        if (cancelled) return
        // The authoritative result, which also covers a fetcher that reports no
        // per-station progress at all.
        setLive(result.live)
        setFetchedAt(new Date())
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        console.warn('Availability lookup failed:', err)
      } finally {
        // Nothing is still in flight either way, including after a wipeout —
        // rows must not spin forever because the upstream is down.
        if (!cancelled) setPending(new Set())
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [wanted, nonce])

  return { live, fetchedAt, pending }
}
