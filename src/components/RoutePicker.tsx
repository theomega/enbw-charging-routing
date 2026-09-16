import type { ChargerOnRoute, LatLon } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { formatDistance, formatDuration, formatDurationDelta } from './format'
import { ExpandIcon } from './icons'
import { strokeColours } from './routeColours'
import { RouteMap } from './RouteMap'

interface Props {
  routes: RouteOption[]
  selected: RouteOption | null
  onSelect: (id: string) => void
  /** Open the selected route full-screen, for a closer look at how it runs. */
  onExpand: () => void
  chargers: ChargerOnRoute[]
  /** Tapping a charger dot opens that charger's row in the list below. */
  onSelectCharger?: (chargerId: string) => void
  position: LatLon | null
  /**
   * How far the driver has already come along the selected route, subtracted
   * from every alternative's total so the rows read as what is left rather than
   * as what the whole journey was.
   *
   * One figure for all of them, which is both simpler and right: the
   * alternatives share the trunk the driver is on, and subtracting a constant
   * leaves the deltas between them exact.
   */
  drivenM?: number
  drivenS?: number
}

/**
 * Which way are we actually going?
 *
 * Mapbox returns up to three routes and the app used to silently take the first
 * without ever showing it. On a trip like Berlin -> Dorf Tirol the alternatives
 * are genuinely different drives (Jaufenpass vs Brenner) with entirely different
 * chargers along them, so the choice belongs to the driver.
 *
 * All of them go on one map. Side-by-side thumbnails cannot answer "which of
 * these do I want" — the eye has to compare two pictures instead of one. Drawn
 * together, the shared trunk overlaps and only the part where they differ
 * stands out, which is the only part the decision turns on.
 *
 * The map is live, so a route can be picked by tapping its line. The rows below
 * are both the legend and the same choice in words, for the times a line is
 * buried under another one.
 */
export function RoutePicker({
  routes,
  selected,
  onSelect,
  onExpand,
  chargers,
  onSelectCharger,
  position,
  drivenM = 0,
  drivenS = 0,
}: Props) {
  if (routes.length === 0 || !selected) return null

  const fastest = routes[0]
  // Same rule the map draws by, so a swatch and a line are the same colour.
  const colours = strokeColours(routes.map((option) => ({ selected: option.id === selected.id })))

  return (
    <div className="border-b border-slate-800 p-3">
      <div className="relative overflow-hidden rounded-xl bg-slate-900">
        <RouteMap
          routes={routes}
          selectedId={selected.id}
          onSelectRoute={onSelect}
          chargers={chargers}
          onSelectCharger={onSelectCharger}
          position={position}
          // Embedded in the scrolling page: one finger must still scroll past it.
          cooperativeGestures
          className="aspect-video w-full"
        />
        {/*
          A separate control rather than a tap on the map itself, which now
          belongs to picking routes and panning. Top right: Mapbox owns both
          bottom corners (logo left, attribution right) and a control placed
          there is simply covered.
        */}
        <button
          onClick={onExpand}
          aria-label="Route im Vollbild anzeigen"
          className="absolute right-2 top-2 rounded-lg bg-slate-950/85 p-2 text-slate-200 ring-1 ring-slate-700"
        >
          <ExpandIcon />
        </button>
      </div>

      <ul className="mt-2 space-y-1.5">
        {routes.map((option, i) => (
          <li key={option.id}>
            <RouteRow
              option={option}
              fastest={fastest}
              colour={colours[i]}
              isSelected={option.id === selected.id}
              // With a single route there is nothing to choose, so the row is a
              // caption rather than a picker pretending otherwise.
              showLegend={routes.length > 1}
              drivenM={drivenM}
              drivenS={drivenS}
              onSelect={() => onSelect(option.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function RouteRow({
  option,
  fastest,
  colour,
  isSelected,
  showLegend,
  drivenM,
  drivenS,
  onSelect,
}: {
  option: RouteOption
  fastest: RouteOption
  /** The colour this route is drawn with on the map. */
  colour: string
  isSelected: boolean
  showLegend: boolean
  drivenM: number
  drivenS: number
  onSelect: () => void
}) {
  // Off the full totals, not the remaining ones: the gap between two
  // alternatives is what this reports, and a shared constant cancels out of it.
  const delta = option.route.totalDurationS - fastest.route.totalDurationS

  return (
    <button
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${
        isSelected ? 'bg-slate-900 ring-1 ring-emerald-800' : 'bg-slate-900/50'
      }`}
    >
      {showLegend && (
        // Drawn from the map's own palette rather than a Tailwind class, so the
        // two can never drift apart.
        <span
          aria-hidden
          className="h-1 w-6 shrink-0 rounded-full"
          style={{ backgroundColor: colour }}
        />
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-100">
          {option.summary ? `via ${option.summary}` : 'Route'}
        </span>
        <span className="block text-xs text-slate-400">
          {formatDuration(Math.max(0, option.route.totalDurationS - drivenS))} ·{' '}
          {formatDistance(Math.max(0, option.route.totalDistanceM - drivenM))}
        </span>
      </span>

      {showLegend && (
        <span className={`shrink-0 text-xs ${delta <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
          {formatDurationDelta(delta)}
        </span>
      )}

      {isSelected && showLegend && (
        <span className="shrink-0 text-emerald-400" aria-label="Ausgewählt">
          ✓
        </span>
      )}
    </button>
  )
}
