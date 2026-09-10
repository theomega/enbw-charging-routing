import type { ChargerOnRoute } from '../core/types'
import type { MapsApp } from '../nav/deepLinks'
import { useChargerDetail } from '../search/useChargerDetail'
import type { RouteOption } from '../services/mapbox/directions'
import { ChargerDetail } from './ChargerDetail'
import { formatDetour, formatDistance, formatDuration, formatPower } from './format'
import { ChevronIcon } from './icons'

interface Props {
  item: ChargerOnRoute
  mapsApp: MapsApp
  route: RouteOption | null
  expanded: boolean
  onToggle: () => void
  /** True when the search pipeline already looks this charger up. */
  enriched: boolean
}

/**
 * One charger row, collapsed to a summary and expandable to the full detail.
 *
 * The whole card used to be the navigation link, on the reasoning that a small
 * tap area is the wrong answer in a car. That reasoning still holds, so the
 * summary is still a single full-width target — it just opens the charger
 * instead of handing straight off to a maps app. Committing to a stop is now a
 * separate, deliberate tap at the bottom of the panel, which is the right shape
 * for a decision you cannot undo once you are driving towards it.
 *
 * Collapsed, this renders exactly what it always did: the list stays scannable.
 *
 * The live lookup lives here rather than down in the panel, because the header
 * reads it too: the availability badge has to change when the record lands, and
 * the header stays on screen while the panel is open. It is still gated on
 * `expanded`, so nothing is fetched for a row nobody opened.
 */
export function ChargerCard({ item, mapsApp, route, expanded, onToggle, enriched }: Props) {
  const { charger, loading } = useChargerDetail(item.charger, enriched, expanded)
  if (!charger) return null

  const available = charger.availablePoints
  const panelId = `charger-detail-${charger.id}`

  return (
    <div className="overflow-hidden rounded-xl bg-slate-900 ring-1 ring-slate-800">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="block w-full p-4 text-left transition active:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/*
              The location — "ENI Schottwien", the name on the sign you are
              looking for — beats the street it stands on. It comes out of the
              shipped list rather than a lookup, so this heading is settled
              before the row is ever drawn; the street label is the fallback for
              the few stations EnBW gives no location for.
            */}
            <h3 className="truncate font-semibold text-slate-100">
              {charger.notes || charger.name}
            </h3>
            {charger.address && (
              <p className="truncate text-sm text-slate-400">{charger.address}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AvailabilityBadge available={available} total={charger.totalPoints} />
            <ChevronIcon
              className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </div>
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
      </button>

      {/*
        Mounted only while open. The panel carries a live Mapbox GL map, and the
        list renders every charger on the route — keeping them all mounted would
        put dozens of WebGL contexts on a phone.
      */}
      {expanded && (
        <ChargerDetail
          id={panelId}
          item={item}
          charger={charger}
          loading={loading}
          route={route}
          mapsApp={mapsApp}
        />
      )}
    </div>
  )
}

export function Stat({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
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
export function AvailabilityBadge({
  available,
  total,
}: {
  available: number | null
  total: number
}) {
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
