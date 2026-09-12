import type { ChargerOnRoute } from '../core/types'
import type { MapsApp } from '../nav/deepLinks'
import { useChargerDetail } from '../search/useChargerDetail'
import type { RouteOption } from '../services/mapbox/directions'
import { BADGE_TONE, availabilityState } from './availability'
import { ChargerDetail } from './ChargerDetail'
import { Fact } from './Fact'
import {
  distanceOrEstimate,
  formatDetour,
  formatDistance,
  formatDuration,
  formatPower,
  formatProgress,
} from './format'
import { ChevronIcon, SpinnerIcon } from './icons'

interface Props {
  item: ChargerOnRoute
  mapsApp: MapsApp
  route: RouteOption | null
  expanded: boolean
  onToggle: () => void
  /** True when the search pipeline already looks this charger up. */
  enriched: boolean
  /** True while the pipeline's lookup for this row is in flight. */
  refreshing: boolean
  /** Bumped by Refresh, so a row holding its own live record re-reads it too. */
  refreshNonce: number
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
 *
 * The summary row is three figures that are three different measurements, and
 * readers kept adding them up, so the labels are chosen to keep them apart.
 * "Auf der Route" is a position *on the route line* and never leaves it, which
 * is why it reads smaller than the road to the charger beside it. "Zur
 * Ladestation" is that road, measured to the station itself. "Umweg" is a
 * whole-journey figure — there and back on — so it is not the difference
 * between the two and must not read as if it were.
 */
export function ChargerCard({
  item,
  mapsApp,
  route,
  expanded,
  onToggle,
  enriched,
  refreshing,
  refreshNonce,
}: Props) {
  const { charger, loading } = useChargerDetail(item.charger, enriched, expanded, refreshNonce)
  if (!charger) return null

  const available = charger.availablePoints
  const panelId = `charger-detail-${charger.id}`

  const legs = item.legs
  const total = route?.route.totalDistanceM ?? 0

  const toCharger = distanceOrEstimate(legs?.toChargerM, item.alongDistanceM + item.offsetM)

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
            {/*
              A row outside the enriched set has no pipeline lookup to wait for,
              so its own fetch is what the badge reports instead — on first open
              and on every Refresh after it.
            */}
            <AvailabilityBadge
              available={available}
              total={charger.totalPoints}
              refreshing={refreshing || loading}
            />
            <ChevronIcon
              className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Fact
            label="Auf der Route"
            value={formatDistance(item.alongDistanceM)}
            sub={`${formatDuration(item.alongDurationS)} · ${formatProgress(item.alongDistanceM, total)} der Strecke`}
          />
          <Fact
            label="Zur Ladestation"
            value={toCharger}
            sub={
              legs?.toChargerS != null ? formatDuration(legs.toChargerS) : 'aus der Route geschätzt'
            }
          />
          {/*
            "extra" and not "mehr auf der ganzen Fahrt", which is what this
            figure actually measures: the card is three columns wide on a phone
            and the full phrase wraps to four lines there. The framing it drops
            — that the detour is a whole-journey figure, there and back on, and
            so is not the gap between the two cells to its left — belongs
            somewhere with room to say it.
          */}
          <Fact
            label="Umweg"
            value={formatDetour(item.detourS)}
            sub={item.detourM != null ? `${formatDistance(item.detourM)} extra` : 'nicht berechnet'}
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

/**
 * `null` means the provider has no live data at all, which is a different
 * statement from "zero free" — never render the two the same way.
 *
 * `refreshing` adds a spinner *beside* the numbers rather than replacing them.
 * The last measurement is still the best answer a driver has until the next one
 * lands, and swapping 45 badges for placeholders on every Refresh would throw
 * away the whole list to report on something that usually comes back unchanged.
 * The spinner is the only thing that says a refresh is happening at all when it
 * does come back unchanged.
 */
export function AvailabilityBadge({
  available,
  total,
  refreshing = false,
}: {
  available: number | null
  total: number
  refreshing?: boolean
}) {
  const tone = BADGE_TONE[availabilityState(available)]
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${tone}`}
      aria-busy={refreshing || undefined}
    >
      {available == null ? `?/${total}` : `${available}/${total} frei`}
      {refreshing && <SpinnerIcon />}
    </span>
  )
}
