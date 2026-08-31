import { useState } from 'react'
import { ChargerList } from './components/ChargerList'
import { DestinationSearch } from './components/DestinationSearch'
import { SettingsSheet } from './components/SettingsSheet'
import { formatClock, formatDistance, formatDuration } from './components/format'
import { useGeolocation } from './hooks/useGeolocation'
import { useRouteSearch } from './hooks/useRouteSearch'
import { useAppStore } from './state/store'

export default function App() {
  const [showSearch, setShowSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const destination = useAppStore((s) => s.lastDestination)
  const setDestination = useAppStore((s) => s.setDestination)

  const { position, error: geoError, loading: geoLoading } = useGeolocation()
  const search = useRouteSearch(position, destination)

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="flex items-center gap-2 p-3">
          <button
            onClick={() => setShowSearch(true)}
            className="min-w-0 flex-1 rounded-lg bg-slate-900 px-4 py-3 text-left ring-1 ring-slate-800"
          >
            {destination ? (
              <>
                <div className="text-xs uppercase tracking-wide text-slate-500">Destination</div>
                <div className="truncate font-medium text-slate-100">{destination.name}</div>
              </>
            ) : (
              <span className="text-slate-400">Where are you going?</span>
            )}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            className="rounded-lg bg-slate-900 px-3 py-3 ring-1 ring-slate-800"
          >
            ⚙
          </button>
        </div>

        {search.route && (
          <div className="flex items-center justify-between px-4 pb-3 text-xs text-slate-500">
            <span>
              Route {formatDistance(search.route.totalDistanceM)} ·{' '}
              {formatDuration(search.route.totalDurationS)}
            </span>
            <button onClick={search.refresh} className="font-medium text-emerald-400">
              {search.fetchedAt ? `Updated ${formatClock(search.fetchedAt)} · Refresh` : 'Refresh'}
            </button>
          </div>
        )}
      </header>

      <main className="flex-1">
        {geoError && (
          <div className="m-4 rounded-xl bg-amber-950 p-4 text-sm text-amber-200">{geoError}</div>
        )}

        {!destination && (
          <div className="p-8 text-center text-slate-500">
            <p className="text-4xl" aria-hidden>
              ⚡
            </p>
            <p className="mt-3">Pick a destination to see EnBW chargers along the way.</p>
          </div>
        )}

        {destination && !position && geoLoading && (
          <p className="p-8 text-center text-sm text-slate-500">Waiting for your position…</p>
        )}

        {destination && position && (
          <ChargerList
            status={search.status}
            results={search.results}
            unfilteredCount={search.unfilteredCount}
            error={search.error}
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
    </div>
  )
}
