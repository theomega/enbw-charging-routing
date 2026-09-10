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
 *
 * A row this hook *does* own is re-read on that same Refresh, which is why it
 * takes the nonce. Without it, opening row 46 once left its badge frozen at
 * whatever it measured then — a number the list went on displaying, collapsed
 * and unmarked, under a header claiming everything was updated seconds ago.
 * One stale badge among 45 fresh ones is the worst possible failure here: it is
 * indistinguishable from a live reading.
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
  /** Bumped by the search-wide Refresh; a row holding its own record re-reads it. */
  nonce: number,
): {
  charger: Charger | null
  loading: boolean
} {
  const [extra, setExtra] = useState<{ id: string; nonce: number; live: LiveStation } | null>(null)
  const [loading, setLoading] = useState(false)

  const id = charger?.id ?? null
  /**
   * Nobody else will fetch this one. Keyed on the pipeline's own enriched set
   * rather than on `chargePoints == null`, which is also briefly true for a
   * top-20 row whose lookup is still in flight — fetching then would duplicate
   * a request already on the wire.
   */
  const ownsLookup = !!charger && !pipelineFetches && charger.chargePoints == null
  /**
   * A record of its own is the only way a collapsed row can be here, since
   * `extra` is set nowhere but the branch below — so this widens Refresh to
   * exactly the rows the driver already spent a request on, and to no others.
   * Closing the panel must not strand a badge the list keeps showing.
   */
  const holdsOwnRecord = !!id && extra?.id === id
  const shouldFetch = ownsLookup && (active || holdsOwnRecord)

  useEffect(() => {
    if (!id || !shouldFetch) return
    // Already fetched for this charger at this nonce. Re-running here is how
    // the effect settles after it sets `extra`; it must not fetch again until
    // Refresh moves the nonce on.
    if (extra?.id === id && extra.nonce === nonce) return

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        setLoading(true)
        const { live } = await fetchAvailability([{ id }], { signal: controller.signal })
        if (cancelled) return
        const record = live.get(id)
        // Left alone when the station does not answer, rather than cleared: the
        // previous reading is old but real, and the alternative is a row that
        // drops to "?/n" on a refresh it was never asked to survive. It also
        // keeps the nonce behind, so the next Refresh tries this station again.
        if (record) setExtra({ id, nonce, live: record })
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
  }, [id, shouldFetch, extra, nonce])

  if (!charger) return { charger: null, loading: false }
  // The pipeline's copy wins outright once it has one: a search-wide Refresh is
  // newer than whatever this hook fetched when the panel was first opened.
  if (!ownsLookup) return { charger, loading: false }
  if (extra?.id !== charger.id) return { charger, loading }
  // `loading` rather than a hardcoded false: with Refresh in the picture a
  // re-read can be in flight over a record that is already on screen, and that
  // is exactly the state the row's spinner reports.
  return { charger: { ...charger, ...extra.live }, loading }
}
