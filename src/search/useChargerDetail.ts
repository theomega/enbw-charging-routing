import { useEffect, useState } from 'react'
import type { Charger } from '../core/types'
import { fetchAvailability, type LiveStation } from '../services/enbw/availability'

/**
 * Fill in the live record for one charger the pipeline never enriched.
 *
 * Only the first `ENRICHED_LIMIT` rows are looked up during a search, because
 * that is one upstream request each. Opening the detail panel on row 21 is a
 * deliberate, single act by the driver, so it can afford exactly one request —
 * through the same Worker route, which already accepts any station id.
 *
 * A charger that already carries `chargePoints` is left alone: the pipeline
 * fetched it, and the search-wide Refresh keeps it current.
 */
export function useChargerDetail(
  charger: Charger | null,
  /** True when the search pipeline is already fetching this one; then do nothing. */
  pipelineFetches: boolean,
  /**
   * False while the driver has not asked for this charger yet. The hook is held
   * by the card rather than by the panel — the header reads the live record too
   * — and the list renders hundreds of cards, so the lookup stays gated on the
   * one deliberate act that pays for it. Whatever was already fetched keeps
   * being returned when this goes false again.
   */
  active: boolean,
): {
  charger: Charger | null
  loading: boolean
} {
  const [extra, setExtra] = useState<{ id: string; live: LiveStation } | null>(null)
  const [loading, setLoading] = useState(false)

  const id = charger?.id ?? null
  /**
   * Nobody else will fetch this one. Keyed on the pipeline's own enriched set
   * rather than on `chargePoints == null`, which is also briefly true for a
   * top-20 row whose lookup is still in flight — fetching then would duplicate
   * a request already on the wire.
   */
  const ownsLookup = !!charger && !pipelineFetches && charger.chargePoints == null
  const shouldFetch = ownsLookup && active

  useEffect(() => {
    if (!id || !shouldFetch) return
    // Already fetched for this charger on an earlier open. Re-running here is
    // how the effect settles after it sets `extra`; it must not fetch again.
    if (extra?.id === id) return

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        setLoading(true)
        const { live } = await fetchAvailability([{ id }], { signal: controller.signal })
        if (cancelled) return
        const record = live.get(id)
        if (record) setExtra({ id, live: record })
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        // Same rule as the list: the panel is still worth reading without this.
        console.warn('Charger detail lookup failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [id, shouldFetch, extra])

  if (!charger) return { charger: null, loading: false }
  // The pipeline's copy wins outright once it has one: a search-wide Refresh is
  // newer than whatever this hook fetched when the panel was first opened.
  if (!ownsLookup) return { charger, loading: false }
  if (extra?.id !== charger.id) return { charger, loading }
  return { charger: { ...charger, ...extra.live }, loading: false }
}
