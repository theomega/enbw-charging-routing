import type { RouteOption } from '../services/mapbox/directions'
import { staticMapUrl, strokeColours } from '../services/mapbox/staticMap'
import { formatDistance, formatDuration, formatDurationDelta } from './format'

interface Props {
  routes: RouteOption[]
  selected: RouteOption | null
  onSelect: (id: string) => void
  /** Open the selected route full-screen, for a closer look at how it runs. */
  onExpand: () => void
}

/**
 * Which way are we actually going?
 *
 * Mapbox returns up to three routes and the app used to silently take the first
 * without ever showing it. On a trip like Berlin -> Dorf Tirol the alternatives
 * are genuinely different drives (Jaufenpass vs Brenner) with entirely different
 * chargers along them, so the choice belongs to the driver.
 *
 * All of them go on one map. A row of thumbnails cannot answer "which of these
 * do I want" — at that size every route is the same grey squiggle, and the eye
 * has to compare two pictures instead of one. Drawn together, the shared trunk
 * overlaps and only the part where they differ stands out, which is the only
 * part the decision turns on. The rows below are the legend.
 */

/**
 * Rendered at the column width (max-w-xl less padding) in 16:9. The exact
 * numbers only set the pixel density of the fetched PNG; CSS does the layout.
 */
const MAP_WIDTH = 560
const MAP_HEIGHT = 315

export function RoutePicker({ routes, selected, onSelect, onExpand }: Props) {
  if (routes.length === 0 || !selected) return null

  const fastest = routes[0]
  const layers = routes.map((option) => ({
    route: option.route,
    selected: option.id === selected.id,
  }))
  const map = staticMapUrl(layers, { width: MAP_WIDTH, height: MAP_HEIGHT, pins: true })
  // Same rule the image is drawn by, so a swatch and a line are the same colour.
  const colours = strokeColours(layers)

  return (
    <div className="border-b border-slate-800 p-3">
      {map ? (
        <button
          onClick={onExpand}
          aria-label="Show route full screen"
          className="relative block w-full overflow-hidden rounded-xl bg-slate-900"
        >
          <img
            src={map}
            alt=""
            width={MAP_WIDTH}
            height={MAP_HEIGHT}
            className="aspect-video w-full object-cover"
          />
          <span
            aria-hidden
            className="absolute bottom-2 right-2 rounded-lg bg-slate-950/80 px-2 py-1 text-sm text-slate-200 ring-1 ring-slate-700"
          >
            ⛶
          </span>
        </button>
      ) : (
        // No Mapbox token, or a degenerate route — degrade to the rows alone,
        // never a broken image.
        <div className="aspect-video w-full rounded-xl bg-slate-900" aria-hidden />
      )}

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
  onSelect,
}: {
  option: RouteOption
  fastest: RouteOption
  /** The stroke this route is drawn with on the map, as a bare hex triplet. */
  colour: string
  isSelected: boolean
  showLegend: boolean
  onSelect: () => void
}) {
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
          style={{ backgroundColor: `#${colour}` }}
        />
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-100">
          {option.summary ? `via ${option.summary}` : 'Route'}
        </span>
        <span className="block text-xs text-slate-400">
          {formatDuration(option.route.totalDurationS)} ·{' '}
          {formatDistance(option.route.totalDistanceM)}
        </span>
      </span>

      {showLegend && (
        <span
          className={`shrink-0 text-xs ${delta <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}
        >
          {formatDurationDelta(delta)}
        </span>
      )}

      {isSelected && showLegend && (
        <span className="shrink-0 text-emerald-400" aria-label="Selected">
          ✓
        </span>
      )}
    </button>
  )
}
