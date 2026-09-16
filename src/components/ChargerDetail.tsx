import { useMemo } from 'react'
import type { Charger, ChargerOnRoute } from '../core/types'
import { navigationUrl, type MapsApp } from '../nav/deepLinks'
import type { RouteOption } from '../services/mapbox/directions'
import { TEXT_TONE, availabilityState } from './availability'
import { describeGroup, groupChargePoints } from './chargePointGroups'
import { Fact } from './Fact'
import { distanceOrEstimate, formatDuration, formatPower } from './format'
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
  /** The Ladeleistung setting, which the badge above this panel counts by. */
  minPowerKw: number
}

/** One charger, in full: only what the card's header and summary row cannot show. */
export function ChargerDetail({ item, charger, loading, route, mapsApp, id, minPowerKw }: Props) {
  // Effect inputs inside RouteMap: a fresh array each render would push the
  // whole route geometry back into the GL source every time.
  const mapRoutes = useMemo(() => (route ? [route] : []), [route])
  const mapChargers = useMemo(() => [item], [item])

  /**
   * Every group the station has, with the ones the Ladeleistung setting excludes
   * marked rather than dropped.
   *
   * The panel is the full truth about a station — it is where you look when the
   * badge is not enough — and hiding the AC posts would make the station look
   * smaller than it is. Marking them is also what makes the badge legible: it
   * says "2/4" over a list of eight, and this is the only place that difference
   * can be accounted for.
   */
  const groups = useMemo(
    () =>
      (charger.chargePoints ? groupChargePoints(charger.chargePoints) : []).map((group) => ({
        group,
        // Unknown power is counted, exactly as the badge and the station filter
        // count it: "might be fast" is not grounds for striking a stall out.
        excluded: group.maxPowerKw != null && group.maxPowerKw < minPowerKw,
      })),
    [charger.chargePoints, minPowerKw],
  )

  const pointCount = charger.chargePoints?.length ?? 0
  const matching = groups
    .filter(({ excluded }) => !excluded)
    .reduce((n, { group }) => n + group.count, 0)

  const legs = item.legs
  const total = route?.route.totalDistanceM ?? 0

  const remaining = distanceOrEstimate(
    legs?.fromChargerM,
    total > 0 ? Math.max(0, total - item.alongDistanceM) : null,
  )

  // No route means no estimate either, and the note would caption an em dash.
  const remainingSub =
    legs?.fromChargerS != null
      ? formatDuration(legs.fromChargerS)
      : remaining === '—'
        ? undefined
        : 'aus der Route geschätzt'

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

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
        <Fact label="Weiterfahrt zum Ziel" value={remaining} sub={remainingSub} />

        {/* Null is "never fetched", not "no". */}
        {charger.alwaysOpen != null && (
          <Fact
            label="Zugang"
            value={charger.alwaysOpen ? 'Rund um die Uhr geöffnet' : 'Eingeschränkte Zeiten'}
          />
        )}
      </dl>

      <section className="mt-5">
        {/*
          The threshold is named here and nowhere else in the list: it is the
          one line with room for it, and repeating "unter 50 kW" on every muted
          row below would only restate the kW figure already on that row.
        */}
        <h4 className="text-xs uppercase tracking-wide text-slate-500">
          Ladesäulen
          {charger.chargePoints &&
            (matching < pointCount
              ? ` (${matching} von ${pointCount} ab ${minPowerKw} kW)`
              : ` (${pointCount})`)}
        </h4>
        {/* Only while there is nothing to show; a Refresh over a full list is
            reported by the badge's spinner instead. */}
        {loading && !charger.chargePoints && (
          <p className="mt-2 text-sm text-slate-500">Ladesäulen werden geladen …</p>
        )}
        {!loading && !charger.chargePoints && (
          <p className="mt-2 text-sm text-slate-500">
            EnBW hat für diese Station nicht geantwortet, die einzelnen Ladesäulen sind daher
            unbekannt.
          </p>
        )}
        {groups.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {groups.map(({ group, excluded }) => (
              <li
                key={group.key}
                className={`rounded-lg bg-slate-950 px-3 py-2 text-sm ${excluded ? 'opacity-50' : ''}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className={`shrink-0 font-medium ${excluded ? 'text-slate-400' : 'text-emerald-300'}`}
                  >
                    {formatPower(group.maxPowerKw)}
                  </p>
                  <p className="truncate text-slate-200">
                    {group.plugs.length > 0 ? group.plugs.join(' · ') : 'Unbekannter Stecker'}
                  </p>
                </div>
                {/*
                  An excluded group keeps its own free count in grey rather than
                  in the availability colours. The number is still true, and a
                  green "2 von 4 frei" on a row that the badge above does not
                  count would read as a contradiction.
                */}
                <p className={`text-xs ${excluded ? 'text-slate-500' : freeTone(group.free)}`}>
                  {describeGroup(group)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <a
        href={navigationUrl(charger, mapsApp)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 block rounded-xl bg-emerald-600 px-4 py-3 text-center font-semibold text-white transition active:bg-emerald-700"
      >
        Hierhin navigieren
      </a>
    </div>
  )
}

/** The same states the station's badge and its map dot colour by. */
const freeTone = (free: number | null): string => TEXT_TONE[availabilityState(free)]
