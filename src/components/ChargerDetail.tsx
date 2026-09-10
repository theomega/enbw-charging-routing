import { useMemo } from 'react'
import type { Charger, ChargerOnRoute } from '../core/types'
import { navigationUrl, type MapsApp } from '../nav/deepLinks'
import type { RouteOption } from '../services/mapbox/directions'
import { describeGroup, groupChargePoints } from './chargePointGroups'
import {
  asEstimate,
  formatDetour,
  formatDistance,
  formatDuration,
  formatPower,
  formatProgress,
} from './format'
import { RouteMap } from './RouteMap'

interface Props {
  item: ChargerOnRoute
  /**
   * The station as currently known, live record merged in where the card has
   * one. Owned by the card, because its header renders from it too.
   */
  charger: Charger
  /** True while the card's own lookup for this station is in flight. */
  loading: boolean
  route: RouteOption | null
  mapsApp: MapsApp
  /** DOM id the card's disclosure button points at. */
  id: string
}

/**
 * One charger, in full.
 *
 * Two questions live here and the layout follows them in order. First "where is
 * this, really" — the map, framed on the charger rather than on the trip.
 * Then "does stopping here work", which is four numbers: how far into the drive
 * it sits, how far it is from where you are now, what the detour costs, and how
 * much road is left afterwards. That last pair is what decides whether the
 * battery reaches it and whether it can be the final stop.
 *
 * Only then the station itself, because none of it matters if the answer to the
 * route questions is no. Which is deliberately little: the card's header and
 * footer already carry the location, the address, the operator, the peak power
 * and the free-point count, and repeating any of them here would only make the
 * panel longer to read past. What is left is what the header cannot say and the
 * charge-point groups do not: the opening hours.
 */
export function ChargerDetail({ item, charger, loading, route, mapsApp, id }: Props) {
  // Memoised for the same reason the pipeline memoises its slices: these are
  // effect inputs inside RouteMap, and a fresh array every render would push
  // the whole route geometry back into the GL source on each one.
  const mapRoutes = useMemo(() => (route ? [route] : []), [route])
  const mapChargers = useMemo(() => [item], [item])

  const legs = item.legs
  const total = route?.route.totalDistanceM ?? 0

  // Rows past ENRICHED_LIMIT were never sent to the Matrix, so their figures
  // come from the route geometry instead — free, on every charger, and marked
  // as estimates so they are not read as measurements.
  const toCharger =
    legs?.toChargerM != null
      ? formatDistance(legs.toChargerM)
      : asEstimate(formatDistance(item.alongDistanceM + item.offsetM))
  const remaining =
    legs?.fromChargerM != null
      ? formatDistance(legs.fromChargerM)
      : total > 0
        ? asEstimate(formatDistance(Math.max(0, total - item.alongDistanceM)))
        : '—'

  return (
    <div id={id} className="border-t border-slate-800 px-4 pb-4 pt-3">
      <div className="overflow-hidden rounded-lg bg-slate-950">
        <RouteMap
          routes={mapRoutes}
          selectedId={route?.id ?? null}
          chargers={mapChargers}
          position={null}
          focus={charger}
          cooperativeGestures
          padding={16}
          className="aspect-[16/10] w-full"
        />
      </div>

      <section className="mt-4">
        <h4 className="text-xs uppercase tracking-wide text-slate-500">On this route</h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
          <Fact
            label="Along the route"
            value={formatDistance(item.alongDistanceM)}
            sub={`${formatProgress(item.alongDistanceM, total)} in · ${formatDuration(item.alongDurationS)} driving`}
          />
          <Fact
            label="From you"
            value={toCharger}
            sub={legs?.toChargerS != null ? formatDuration(legs.toChargerS) : 'by road'}
          />
          <Fact
            label="Detour"
            value={formatDetour(item.detourS)}
            sub={item.detourM != null ? `${formatDistance(item.detourM)} extra` : 'not priced'}
            emphasis={item.detourS != null && item.detourS <= 300}
          />
          <Fact
            label="Left afterwards"
            value={remaining}
            sub={
              legs?.fromChargerS != null ? formatDuration(legs.fromChargerS) : 'to the destination'
            }
          />
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          {item.offsetM < 100
            ? 'Directly on the route.'
            : `${formatDistance(item.offsetM)} off the route.`}
        </p>
      </section>

      {/* Null is "never fetched", not "no" — then the section has nothing to say
          and does not appear at all, rather than heading an empty list. */}
      {charger.alwaysOpen != null && (
        <section className="mt-5">
          <h4 className="text-xs uppercase tracking-wide text-slate-500">Station</h4>
          <dl className="mt-2 space-y-1.5 text-sm">
            <Row label="Opening" value={charger.alwaysOpen ? 'Open 24/7' : 'Restricted hours'} />
          </dl>
        </section>
      )}

      <section className="mt-5">
        <h4 className="text-xs uppercase tracking-wide text-slate-500">
          Charge points
          {charger.chargePoints && ` (${charger.chargePoints.length})`}
        </h4>
        {/*
          Only while there is nothing to show. A Refresh re-reads a panel that
          is already open and full, and captioning the list it is standing on
          would claim the points below are not there yet; the badge's spinner
          is what reports that re-read.
        */}
        {loading && !charger.chargePoints && (
          <p className="mt-2 text-sm text-slate-500">Loading charge points…</p>
        )}
        {!loading && !charger.chargePoints && (
          <p className="mt-2 text-sm text-slate-500">
            EnBW did not answer for this station, so its individual points are unknown.
          </p>
        )}
        {/*
          Grouped rather than listed: a big station has dozens of points and
          almost all of them repeat their neighbour. One row per connector and
          speed says the same thing in three or four lines, and the EVSE id is
          the only thing it costs — a number that matters once you have parked,
          not while you are choosing where to.
        */}
        {charger.chargePoints && charger.chargePoints.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {groupChargePoints(charger.chargePoints).map((group) => (
              <li key={group.key} className="rounded-lg bg-slate-950 px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-slate-200">
                    {group.plugs.length > 0 ? group.plugs.join(' · ') : 'Unknown connector'}
                  </p>
                  <p className="shrink-0 font-medium text-emerald-300">
                    {formatPower(group.maxPowerKw)}
                  </p>
                </div>
                <p className={`text-xs ${freeTone(group.free)}`}>{describeGroup(group)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Navigation used to be the whole card. It is now one deliberate action at
        the end of the panel, after everything a driver would want to read
        before committing to a stop.
      */}
      <a
        href={navigationUrl(charger, mapsApp)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 block rounded-xl bg-emerald-600 px-4 py-3 text-center font-semibold text-white transition active:bg-emerald-700"
      >
        Navigate here
      </a>
    </div>
  )
}

function Fact({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string
  value: string
  sub?: string
  emphasis?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`font-semibold ${emphasis ? 'text-emerald-300' : 'text-slate-100'}`}>
        {value}
      </dd>
      {sub && <dd className="text-xs text-slate-500">{sub}</dd>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  )
}

/** Same three states the station badge colours by: unknown, none, some. */
const freeTone = (free: number | null): string =>
  free == null ? 'text-slate-500' : free === 0 ? 'text-rose-400' : 'text-emerald-400'
