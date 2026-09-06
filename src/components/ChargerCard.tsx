import type { ChargerOnRoute } from '../core/types'
import { navigationUrl, type MapsApp } from '../nav/deepLinks'
import { formatDetour, formatDistance, formatDuration, formatPower } from './format'

interface Props {
  item: ChargerOnRoute
  mapsApp: MapsApp
}

/**
 * One charger row. The whole card is the navigation target — on a phone, in a
 * car, a small tap area is the wrong answer.
 */
export function ChargerCard({ item, mapsApp }: Props) {
  const { charger } = item
  const href = navigationUrl(charger, mapsApp)
  const available = charger.availablePoints

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl bg-slate-900 p-4 ring-1 ring-slate-800 transition active:scale-[0.99] active:bg-slate-800"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-100">{charger.name}</h3>
          {charger.address && (
            <p className="truncate text-sm text-slate-400">{charger.address}</p>
          )}
        </div>
        <AvailabilityBadge available={available} total={charger.totalPoints} />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Stat label="Away" value={formatDistance(item.alongDistanceM)} />
        <Stat label="Drive" value={formatDuration(item.alongDurationS)} />
        <Stat
          label="Detour"
          value={formatDetour(item.detourS)}
          emphasis={item.detourS != null && item.detourS <= 300}
        />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="rounded bg-slate-800 px-2 py-0.5 font-medium text-emerald-300">
          {formatPower(charger.maxPowerKw)}
        </span>
        {charger.operator && <span className="truncate">{charger.operator}</span>}
      </div>
    </a>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={emphasis ? 'font-semibold text-emerald-300' : 'font-semibold text-slate-100'}>
        {value}
      </dd>
    </div>
  )
}

/**
 * `null` means the provider has no live data at all, which is a different
 * statement from "zero free" — never render the two the same way.
 */
function AvailabilityBadge({ available, total }: { available: number | null; total: number }) {
  if (available == null) {
    return (
      <span className="shrink-0 rounded-lg bg-slate-800 px-2.5 py-1 text-sm text-slate-400">
        ?/{total}
      </span>
    )
  }
  const tone =
    available === 0
      ? 'bg-rose-950 text-rose-300'
      : available <= 1
        ? 'bg-amber-950 text-amber-300'
        : 'bg-emerald-950 text-emerald-300'
  return (
    <span className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-semibold ${tone}`}>
      {available}/{total} free
    </span>
  )
}
