import { useCallback, useState } from 'react'
import { ChargerList } from './components/ChargerList'
import { DestinationSearch } from './components/DestinationSearch'
import { RouteMapSheet } from './components/RouteMapSheet'
import { RoutePicker } from './components/RoutePicker'
import { SettingsSheet } from './components/SettingsSheet'
import { formatClock, formatDistance, formatDuration } from './components/format'
import { ExpandIcon, SpinnerIcon } from './components/icons'
import { useGeolocation } from './hooks/useGeolocation'
import { useRouteSearch } from './search/useRouteSearch'
import { useAppStore } from './state/store'

export default function App() {
  const [showSearch, setShowSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showRouteMap, setShowRouteMap] = useState(false)
  /**
   * The charger whose detail panel is open, held as an id rather than as the
   * item. `search.results` is rebuilt on every occupancy and detour refresh, so
   * a stored object would freeze while the row beside it kept updating.
   *
   * One at a time: each panel carries a live Mapbox GL map.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const destination = useAppStore((s) => s.lastDestination)
  const setDestination = useAppStore((s) => s.setDestination)

  const { position, error: geoError, loading: geoLoading } = useGeolocation()
  const search = useRouteSearch(position, destination)
  const refreshing = search.refreshingIds.size > 0

  const toggleCharger = useCallback(
    (chargerId: string) => setExpandedId((open) => (open === chargerId ? null : chargerId)),
    [],
  )

  // Tapping a dot on a map opens that charger's row. The full-screen map has to
  // get out of the way first, or the panel it just opened is behind it.
  const openCharger = useCallback((chargerId: string) => {
    setShowRouteMap(false)
    setExpandedId(chargerId)
  }, [])

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      {/*
        Only the destination and the one-line route summary are pinned. The map
        below is deliberately not: it is worth a third of the screen when you
        are looking at it and nothing at all while you are reading charger rows,
        so it scrolls away and the summary bar reopens it full-screen.
      */}
      <header
        data-sticky-header
        className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur"
      >
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={() => setShowSearch(true)}
            className="min-w-0 flex-1 rounded-lg bg-slate-900 px-4 py-3 text-left ring-1 ring-slate-800"
          >
            {destination ? (
              <>
                <div className="text-xs uppercase tracking-wide text-slate-500">Ziel</div>
                <div className="truncate font-medium text-slate-100">{destination.name}</div>
              </>
            ) : (
              <span className="text-slate-400">Was ist das Ziel der Reise?</span>
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Einstellungen"
            className="rounded-lg bg-slate-900 px-3 py-3 ring-1 ring-slate-800"
          >
            ⚙
          </button>
        </div>

        {search.selected && (
          <div className="flex items-center justify-between gap-3 px-4 pb-3 text-xs text-slate-500">
            {/*
              Always reachable, unlike the control on the map itself, which
              scrolls away with it.
            */}
            <button
              onClick={() => setShowRouteMap(true)}
              className="flex min-w-0 items-center gap-1.5 text-left text-slate-400"
            >
              <span className="truncate">
                {search.selected.summary ? `via ${search.selected.summary} · ` : ''}
                {formatDistance(search.selected.route.totalDistanceM)} ·{' '}
                {formatDuration(search.selected.route.totalDurationS)}
              </span>
              <ExpandIcon className="h-3.5 w-3.5 shrink-0" />
            </button>
            {/*
              Disabled while the fan-out is in flight rather than left tappable:
              a second press aborts 45 requests that were already paid for and
              starts 45 more, and the day's Worker budget is the real limit here.
              The row spinners are what report progress; this only says why the
              button is not taking a press.
            */}
            <button
              onClick={search.refresh}
              disabled={refreshing}
              className="flex shrink-0 items-center gap-1.5 font-medium text-emerald-400 disabled:text-slate-500"
            >
              {refreshing ? (
                <>
                  <SpinnerIcon />
                  Lade Daten…
                </>
              ) : search.fetchedAt ? (
                `Aktualisiert: ${formatClock(search.fetchedAt)} · Aktualisieren`
              ) : (
                'Aktualisieren'
              )}
            </button>
          </div>
        )}
      </header>

      <main className="flex-1">
        {geoError && (
          <div className="m-4 rounded-xl bg-amber-950 p-4 text-sm text-amber-200">{geoError}</div>
        )}

        <RoutePicker
          routes={search.routes}
          selected={search.selected}
          onSelect={search.selectRoute}
          onExpand={() => setShowRouteMap(true)}
          chargers={search.results}
          onSelectCharger={openCharger}
          position={position}
        />

        {!destination && (
          <div className="p-8 text-center text-slate-500">
            <p className="text-4xl" aria-hidden>
              ⚡
            </p>
            <p className="mt-3">
              Wähle ein Ziel aus um hier die ENBW Ladestationen entlang der Route von deinem
              aktuellen Standort zum Ziel zu sehen.
            </p>
          </div>
        )}

        {destination && !position && geoLoading && (
          <p className="p-8 text-center text-sm text-slate-500">Warte auf GPS Position…</p>
        )}

        {destination && position && (
          <ChargerList
            status={search.status}
            results={search.results}
            unfilteredCount={search.unfilteredCount}
            progress={search.progress}
            error={search.error}
            expandedId={expandedId}
            onToggle={toggleCharger}
            route={search.selected}
            enrichedIds={search.enrichedIds}
            refreshingIds={search.refreshingIds}
            refreshNonce={search.refreshNonce}
          />
        )}
      </main>

      {showSearch && (
        <DestinationSearch
          proximity={position}
          onPick={(place) => {
            setDestination(place)
            setShowSearch(false)
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
      {showSettings && <SettingsSheet onClose={() => setShowSettings(false)} />}
      {showRouteMap && search.selected && (
        <RouteMapSheet
          option={search.selected}
          chargers={search.results}
          onSelectCharger={openCharger}
          position={position}
          onClose={() => setShowRouteMap(false)}
        />
      )}
    </div>
  )
}
