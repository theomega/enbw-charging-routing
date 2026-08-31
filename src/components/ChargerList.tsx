import { PROVIDER_FILTER_LABELS, widenFilter } from '../providers/enbw'
import type { ChargerOnRoute } from '../providers/types'
import { useAppStore } from '../state/store'
import type { SearchStatus } from '../hooks/useRouteSearch'
import { ChargerCard } from './ChargerCard'

interface Props {
  status: SearchStatus
  results: ChargerOnRoute[]
  unfilteredCount: number
  error: string | null
}

export function ChargerList({ status, results, unfilteredCount, error }: Props) {
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updateSettings)
  const next = widenFilter(settings.providerFilter)

  if (status === 'error' && error) {
    return (
      <div className="p-4">
        <div className="rounded-xl bg-rose-950 p-4 text-sm text-rose-200">
          <p className="font-semibold">Could not load chargers</p>
          <p className="mt-1 text-rose-300/80">{error}</p>
        </div>
      </div>
    )
  }

  if (status === 'routing' || status === 'scanning') {
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm text-slate-500">
          {status === 'routing' ? 'Calculating route…' : 'Scanning the route for chargers…'}
        </p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-900" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      {/*
        A thin list is the expected outcome of the narrow default filter, not a
        failure — so say which filter caused it and offer the next one up.
      */}
      {results.length < 3 && unfilteredCount > results.length && next && (
        <button
          onClick={() => update({ providerFilter: next })}
          className="w-full rounded-xl bg-slate-900 p-4 text-left ring-1 ring-slate-800"
        >
          <p className="text-sm text-slate-300">
            Only {results.length} charger{results.length === 1 ? '' : 's'} match “
            {PROVIDER_FILTER_LABELS[settings.providerFilter]}”.
          </p>
          <p className="mt-1 text-sm font-medium text-emerald-400">
            Widen to “{PROVIDER_FILTER_LABELS[next]}” →
          </p>
        </button>
      )}

      {results.length === 0 && unfilteredCount === 0 && status === 'ready' && (
        <p className="p-4 text-center text-sm text-slate-500">
          No chargers found within 5 km of this route.
        </p>
      )}

      {results.map((item) => (
        <ChargerCard key={item.charger.id} item={item} mapsApp={settings.mapsApp} />
      ))}
    </div>
  )
}
