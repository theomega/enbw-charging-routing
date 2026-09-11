import { useEffect, useRef } from 'react'
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
  /** The route the panel measures against, for its map and its "left after". */
  route: RouteOption | null
  /** Rows the pipeline fetches live data for; the rest fetch their own on open. */
  enrichedIds: ReadonlySet<string>
  /** Rows whose occupancy lookup is in flight right now. */
  refreshingIds: ReadonlySet<string>
  /** Bumped by Refresh; rows holding their own live record re-read it. */
  refreshNonce: number
}

export function ChargerList({
  status,
  results,
  unfilteredCount,
  progress,
  error,
  expandedId,
  onToggle,
  route,
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
    const header = document.querySelector('[data-sticky-header]')
    row.style.scrollMarginTop = `${(header?.getBoundingClientRect().height ?? 0) + 12}px`
    row.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [expandedId])

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

  if (status === 'routing' || status === 'placing') {
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
            route={route}
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
