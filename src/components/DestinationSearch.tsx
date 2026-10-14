import { useEffect, useRef, useState } from 'react'
import type { Place } from '../core/types'
import { createDestinationSearch, type Suggestion } from '../services/mapbox/searchBox'
import { useAppStore } from '../state/store'
import { SpinnerIcon } from './icons'
import { PlaceIcon } from './placeIcon'

interface Props {
  onPick: (place: Place) => void
  onClose: () => void
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Full-screen destination picker: recents first, then live search results. */
export function DestinationSearch({ onPick, onClose }: Props) {
  const recents = useAppStore((s) => s.recentDestinations)
  const removeRecent = useAppStore((s) => s.removeRecent)

  // One search per open sheet, which is also one billed Mapbox session.
  const [search] = useState(() => createDestinationSearch())

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Suggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  // Debounced so typing does not fire a request per keystroke — a latency
  // concern only, since every keystroke of one search shares a billed session
  // either way. The sheet takes no position, so this depends on the query and
  // nothing else: a moving car no longer re-runs the search every 50 m.
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
      search
        .suggest(trimmed, controller.signal)
        .then((found) => {
          setResults(found)
          setError(null)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setError(message(err))
        })
        .finally(() => setSearching(false))
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, search])

  // A suggestion is only a name until `/retrieve` has run, so picking one is a
  // round trip that can fail on its own.
  async function pick(suggestion: Suggestion) {
    setResolving(suggestion.id)
    setError(null)
    try {
      onPick(await search.resolve(suggestion))
    } catch (err: unknown) {
      setError(`„${suggestion.name}“ konnte nicht geladen werden: ${message(err)}`)
      setResolving(null)
    }
  }

  const showRecents = query.trim().length < 2 && recents.length > 0

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-800 p-3">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Was ist das Ziel der Reise?"
          enterKeyHint="search"
          className="flex-1 rounded-lg bg-slate-900 px-4 py-3 text-base text-slate-100 outline-none ring-1 ring-slate-800 focus:ring-emerald-600"
        />
        <button
          onClick={onClose}
          className="rounded-lg px-3 py-3 text-sm font-medium text-slate-400"
        >
          Abbrechen
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {error && <p className="rounded-lg bg-rose-950 p-3 text-sm text-rose-300">{error}</p>}

        {showRecents && (
          <>
            <h2 className="px-1 pb-2 text-xs uppercase tracking-wide text-slate-500">
              Letzte Ziele
            </h2>
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
                    aria-label={`${place.name} aus letzten Zielen entfernen`}
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
          <p className="p-3 text-sm text-slate-500">Suche läuft…</p>
        )}

        <ul className="space-y-1">
          {results.map((suggestion) => (
            <li key={suggestion.id}>
              <button
                onClick={() => pick(suggestion)}
                disabled={resolving !== null}
                className="flex w-full items-center gap-3 rounded-lg p-3 text-left active:bg-slate-900 disabled:opacity-60"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500">
                  {resolving === suggestion.id ? (
                    <SpinnerIcon className="text-emerald-500" />
                  ) : (
                    <PlaceIcon featureType={suggestion.featureType} maki={suggestion.maki} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-100">
                    {suggestion.name}
                  </span>
                  {suggestion.context && (
                    <span className="block truncate text-sm text-slate-500">
                      {suggestion.context}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {!searching &&
          !showRecents &&
          query.trim().length >= 2 &&
          results.length === 0 &&
          !error && (
            <p className="p-3 text-sm text-slate-500">Keine Ergebnisse für „{query.trim()}“.</p>
          )}
      </div>
    </div>
  )
}
