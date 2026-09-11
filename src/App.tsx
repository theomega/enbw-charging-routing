import { useCallback, useState } from 'react'
import { ChargerList } from './components/ChargerList'
import { DestinationSearch } from './components/DestinationSearch'
import { RouteMapSheet } from './components/RouteMapSheet'
import { RoutePicker } from './components/RoutePicker'
import { SettingsSheet } from './components/SettingsSheet'
import { formatClock, formatDistance, formatDuration } from './components/format'
import { ExpandIcon, RefreshIcon, SpinnerIcon } from './components/icons'
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

  const {
    position,
    error: geoError,
    blocked: geoBlocked,
    loading: geoLoading,
    retry: retryGeo,
  } = useGeolocation()
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
        <div className="flex gap-2 p-3">
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
            className="flex items-center justify-center rounded-lg bg-slate-900 px-3 ring-1 ring-slate-800"
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
              The route summary is what has to survive a 320 px screen, so the
              freshness is a bare timestamp and the control beside it is an icon:
              spelling either of them out costs the summary its travel time.

              It keeps reading the old time while a refresh runs, because the
              numbers it describes are still the ones on screen — useAvailability
              merges each station as it answers rather than blanking the list.
            */}
            <div className="flex shrink-0 items-center gap-2">
              {search.fetchedAt && <span>Stand {formatClock(search.fetchedAt)}</span>}
              {/*
                Disabled while the fan-out is in flight rather than left
                tappable: a second press aborts 45 requests that were already
                paid for and starts 45 more, and the day's Worker budget is the
                real limit here. The row spinners are what report progress; the
                spinner in here only says why the button is not taking a press.

                Fixed box so the spinner swapping in for the icon cannot reflow
                the row, and negative margin so the 36 px tap target does not
                widen it either.
              */}
              <button
                onClick={search.refresh}
                disabled={refreshing}
                aria-label={refreshing ? 'Lädt Daten…' : 'Aktualisieren'}
                className="-m-2.5 flex h-9 w-9 items-center justify-center text-emerald-400 disabled:text-slate-500"
              >
                {refreshing ? <SpinnerIcon className="text-lg" /> : <RefreshIcon />}
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {geoError && (
          <div className="m-4 rounded-xl bg-amber-950 p-4 text-sm text-amber-200">
            <p>{geoError}</p>
            {geoBlocked && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-200/80">
                <li>
                  In Safari auf „a<span className="text-base">A</span>“ in der Adressleiste tippen →
                  „Website-Einstellungen“ → Standort auf „Fragen“ oder „Erlauben“.
                </li>
                <li>
                  Einstellungen → Apps → Safari → Standort auf „Fragen“ stellen (bei älteren
                  iOS-Versionen: Einstellungen → Safari).
                </li>
                <li>
                  Einstellungen → Datenschutz &amp; Sicherheit → Ortungsdienste einschalten und für
                  „Safari-Websites“ „Beim Verwenden der App“ erlauben.
                </li>
                <li>Danach „Erneut versuchen“ tippen oder die Seite neu laden.</li>
              </ol>
            )}
            <button
              onClick={retryGeo}
              className="mt-3 rounded-lg bg-amber-900 px-3 py-2 font-medium text-amber-100 ring-1 ring-amber-800"
            >
              Erneut versuchen
            </button>
          </div>
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
