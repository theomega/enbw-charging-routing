import { useEffect, useLayoutEffect, useRef } from 'react'
import { DEFAULT_MAX_OFFSET_M } from '../core/corridor'
import type { ChargerOnRoute } from '../core/types'
import type { SearchStatus } from '../search/useRouteSearch'
import type { RouteOption } from '../services/mapbox/directions'
import { useAppStore } from '../state/store'
import { ChargerCard } from './ChargerCard'

interface Props {
  status: SearchStatus
  results: ChargerOnRoute[]
  unfilteredCount: number
  /** 0..1 while the corridor is being placed. */
  progress: number | null
  error: string | null
  /** The charger whose detail panel is open, if any. */
  expandedId: string | null
  onToggle: (chargerId: string) => void
  /** The route the panel measures against, for its map. */
  route: RouteOption | null
  /** What is left of the journey from here, for the along-route share. */
  remainingDistanceM: number
  /**
   * Metres the driver has covered along the route. Not displayed — it is the
   * signal that the list changed because the car moved, which is the one case
   * the scroll anchor below exists for.
   */
  drivenM: number
  /** Rows the pipeline fetches live data for; the rest fetch their own on open. */
  enrichedIds: ReadonlySet<string>
  /** Rows whose occupancy lookup is in flight right now. */
  refreshingIds: ReadonlySet<string>
  /** Bumped by Refresh; rows holding their own live record re-read it. */
  refreshNonce: number
}

interface Anchor {
  id: string
  /** Its viewport-relative top, which is what has to survive the change. */
  top: number
}

/**
 * How long after a touch-scroll a correction is skipped.
 *
 * On iOS a programmatic scroll during momentum cancels the fling, so a
 * correction landing mid-flick feels like the page being grabbed. One
 * uncorrected shift is the better trade.
 */
const MOMENTUM_GRACE_MS = 150

export function ChargerList({
  status,
  results,
  unfilteredCount,
  progress,
  error,
  expandedId,
  onToggle,
  route,
  remainingDistanceM,
  drivenM,
  enrichedIds,
  refreshingIds,
  refreshNonce,
}: Props) {
  const settings = useAppStore((s) => s.settings)

  // The detour cap is optional, so naming it in the empty state has to be too:
  // with "Beliebig" set there is no cap to have removed anything.
  const detourClause =
    settings.maxDetourMinutes == null ? '' : ` oder über ${settings.maxDetourMinutes} min Umweg`
  const rows = useRef(new Map<string, HTMLDivElement>())

  // Read by the scroll listener and the layout effect, both of which run
  // outside a render and so cannot close over this render's values.
  const order = useRef<string[]>([])
  order.current = results.map((item) => item.charger.id)
  const expanded = useRef(expandedId)
  expanded.current = expandedId

  const anchor = useRef<Anchor | null>(null)
  const scrolledAt = useRef(0)

  // A charger can also be opened by tapping its dot on the map, which leaves
  // the row anywhere in a long list — usually off-screen.
  //
  // The margin is measured rather than a constant: the header is sticky, so a
  // row aligned to the viewport top would sit under it, and its height changes
  // with the route summary it shows once a route is picked.
  useEffect(() => {
    if (!expandedId) return
    const row = rows.current.get(expandedId)
    if (!row) return
    row.style.scrollMarginTop = `${headerBottom() + 12}px`
    row.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [expandedId])

  /**
   * Keep the anchor's measurement current.
   *
   * A listener rather than a measurement taken when the list changes, because
   * by then it is too late: `useLayoutEffect` runs *after* React has mutated
   * the DOM, and a function component has no `getSnapshotBeforeUpdate`. So the
   * position is captured continuously — throttled to one frame — and the layout
   * effect below only compares against it.
   */
  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      scrolledAt.current = Date.now()
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        anchor.current = measureAnchor(order.current, rows.current, expanded.current)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  /**
   * Hold the station the driver was reading while the car moves under them.
   *
   * Rows are keyed by station id, so React reuses the node of a station that
   * survives — but a key preserves identity, not scroll: the offset belongs to
   * the scrolling document, and when the stations already passed drop off the
   * front, everything below them slides up by their combined height. CSS scroll
   * anchoring does exactly this correction natively and is the right answer
   * eventually, but it reached Safari only in 27, so it cannot be relied on
   * here yet.
   *
   * Keyed on `drivenM` deliberately: that is the only input that changes
   * because the car moved. A filter change or detour pricing landing goes to
   * the top of the list instead, which is what a driver who just changed the
   * filter is looking for.
   */
  useLayoutEffect(() => {
    const held = anchor.current
    const remeasure = () => {
      anchor.current = measureAnchor(order.current, rows.current, expanded.current)
    }

    // Nothing to hold — the list is at the top, or this is the first paint.
    if (!held) return remeasure()
    if (Date.now() - scrolledAt.current < MOMENTUM_GRACE_MS) return remeasure()

    const row = rows.current.get(held.id)
    // That station is gone: passed and out of its grace, or the route changed
    // under it. Treat it as a new list.
    if (!row) {
      window.scrollTo(0, 0)
      return remeasure()
    }

    const delta = row.getBoundingClientRect().top - held.top
    if (Math.abs(delta) >= 1) window.scrollBy(0, delta)
    remeasure()
  }, [drivenM])

  if (status === 'error' && error) {
    return (
      <div className="p-4">
        <div className="rounded-xl bg-rose-950 p-4 text-sm text-rose-200">
          <p className="font-semibold">Ladestationen konnten nicht geladen werden</p>
          <p className="mt-1 text-rose-300/80">{error}</p>
        </div>
      </div>
    )
  }

  /*
    Only while there is nothing to show. A re-place mid-journey — a traffic
    refresh, or a re-route the driver accepted — keeps the rows it already has:
    unmounting them is what lost the scroll position in the first place, and
    their figures are at worst a few hundred milliseconds stale, which is
    nothing next to replacing the list with three grey boxes.
  */
  if ((status === 'routing' || status === 'placing') && results.length === 0) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm text-slate-500">
          {status === 'routing'
            ? 'Route wird berechnet…'
            : 'Ladestationen entlang der Route werden gesucht…'}
        </p>

        {/*
          Placing is real work — every shipped station is measured against the
          route geometry — so it gets a real bar rather than an indeterminate
          shimmer that says nothing about how long is left.
        */}
        {status === 'placing' && progress != null && (
          <div
            role="progressbar"
            aria-label="Ladestationen entlang der Route werden gesucht"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-1.5 overflow-hidden rounded-full bg-slate-900"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-150 ease-out"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}

        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-900" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      {results.length === 0 && status === 'ready' && (
        <p className="p-4 text-center text-sm text-slate-500">
          {unfilteredCount === 0
            ? `Keine EnBW-Ladestationen im Umkreis von ${DEFAULT_MAX_OFFSET_M / 1000} km um diese Route.`
            : `Keine Ladestation passt zu deinen Filtern — ${unfilteredCount} in der Nähe liegen unter ${settings.minPowerKw} kW${detourClause}.`}
        </p>
      )}

      {results.map((item) => (
        <div
          key={item.charger.id}
          ref={(el) => {
            if (el) rows.current.set(item.charger.id, el)
            else rows.current.delete(item.charger.id)
          }}
        >
          <ChargerCard
            item={item}
            mapsApp={settings.mapsApp}
            minPowerKw={settings.minPowerKw}
            route={route}
            remainingDistanceM={remainingDistanceM}
            expanded={expandedId === item.charger.id}
            onToggle={() => onToggle(item.charger.id)}
            enriched={enrichedIds.has(item.charger.id)}
            refreshing={refreshingIds.has(item.charger.id)}
            refreshNonce={refreshNonce}
          />
        </div>
      ))}
    </div>
  )
}

const headerBottom = (): number =>
  document.querySelector('[data-sticky-header]')?.getBoundingClientRect().height ?? 0

/**
 * The row to hold, and where it currently sits.
 *
 * The open panel wins: it is what the driver is working with, and it is the
 * tallest thing on screen, so losing it is the most disorienting outcome.
 * Otherwise it is the topmost row still visible below the sticky header.
 *
 * Null at the top of the list, where there is nothing to restore and a
 * correction could only do harm.
 *
 * Found by binary search rather than by measuring every row: the rows are in
 * document order, so "does this row reach below the header" is monotonic, and
 * this runs once per animation frame while scrolling.
 */
function measureAnchor(
  order: string[],
  rows: Map<string, HTMLDivElement>,
  expandedId: string | null,
): Anchor | null {
  if (typeof window === 'undefined' || window.scrollY <= 4) return null

  if (expandedId) {
    const row = rows.get(expandedId)
    if (row) return { id: expandedId, top: row.getBoundingClientRect().top }
  }

  const floor = headerBottom()
  let lo = 0
  let hi = order.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const row = rows.get(order[mid])
    if (row && row.getBoundingClientRect().bottom > floor) {
      found = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  if (found < 0) return null
  const row = rows.get(order[found])
  return row ? { id: order[found], top: row.getBoundingClientRect().top } : null
}
