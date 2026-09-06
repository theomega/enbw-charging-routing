import { useEffect, useRef, useState } from 'react'
import type { Place } from '../core/types'
import { geocode } from '../services/mapbox/geocoding'
import type { LatLon } from '../core/types'
import { useAppStore } from '../state/store'

interface Props {
  proximity: LatLon | null
  onPick: (place: Place) => void
  onClose: () => void
}

/** Full-screen destination picker: recents first, then live search results. */
export function DestinationSearch({ proximity, onPick, onClose }: Props) {
  const recents = useAppStore((s) => s.recentDestinations)
  const removeRecent = useAppStore((s) => s.removeRecent)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  // Debounced so typing does not fire a geocode request per keystroke.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      geocode(trimmed, proximity, controller.signal)
        .then((places) => {
          setResults(places)
          setError(null)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => setSearching(false))
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, proximity])

  const showRecents = query.trim().length < 2 && recents.length > 0

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-800 p-3">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Where are you going?"
          enterKeyHint="search"
          className="flex-1 rounded-lg bg-slate-900 px-4 py-3 text-base text-slate-100 outline-none ring-1 ring-slate-800 focus:ring-emerald-600"
        />
        <button
          onClick={onClose}
          className="rounded-lg px-3 py-3 text-sm font-medium text-slate-400"
        >
          Cancel
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {error && <p className="rounded-lg bg-rose-950 p-3 text-sm text-rose-300">{error}</p>}

        {showRecents && (
          <>
            <h2 className="px-1 pb-2 text-xs uppercase tracking-wide text-slate-500">Recent</h2>
            <ul className="space-y-1">
              {recents.map((place) => (
                <li key={place.id} className="flex items-center gap-2">
                  <button
                    onClick={() => onPick(place)}
                    className="min-w-0 flex-1 rounded-lg p-3 text-left active:bg-slate-900"
                  >
                    <div className="truncate font-medium text-slate-100">{place.name}</div>
                    {place.context && (
                      <div className="truncate text-sm text-slate-500">{place.context}</div>
                    )}
                  </button>
                  <button
                    onClick={() => removeRecent(place.id)}
                    aria-label={`Remove ${place.name}`}
                    className="rounded-lg px-3 py-3 text-slate-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {searching && results.length === 0 && (
          <p className="p-3 text-sm text-slate-500">Searching…</p>
        )}

        <ul className="space-y-1">
          {results.map((place) => (
            <li key={place.id}>
              <button
                onClick={() => onPick(place)}
                className="w-full rounded-lg p-3 text-left active:bg-slate-900"
              >
                <div className="truncate font-medium text-slate-100">{place.name}</div>
                {place.context && (
                  <div className="truncate text-sm text-slate-500">{place.context}</div>
                )}
              </button>
            </li>
          ))}
        </ul>

        {!searching && !showRecents && query.trim().length >= 2 && results.length === 0 && !error && (
          <p className="p-3 text-sm text-slate-500">Nothing found for “{query.trim()}”.</p>
        )}
      </div>
    </div>
  )
}
