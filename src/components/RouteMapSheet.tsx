import { useElementSize } from '../hooks/useElementSize'
import type { RouteOption } from '../services/mapbox/directions'
import { staticMapUrl } from '../services/mapbox/staticMap'
import { formatDistance, formatDuration } from './format'

/**
 * The chosen route, as large as the screen allows.
 *
 * The picker's map answers "which of these?"; this one answers the question
 * that comes later, halfway down the charger list — "wait, does this thing
 * really go the way I think it does?". Only the selected route is drawn: the
 * alternatives are noise once the choice is made.
 *
 * The image is sized from the container rather than a guess, because a static
 * map is fetched at fixed dimensions and Mapbox frames the route to fit them —
 * ask for the wrong aspect ratio and the route sits in a letterboxed band.
 */
export function RouteMapSheet({
  option,
  onClose,
}: {
  option: RouteOption
  onClose: () => void
}) {
  const [ref, size] = useElementSize<HTMLDivElement>()
  // Null on the first paint, before the container has been measured.
  const map = size ? staticMapUrl([{ route: option.route, selected: true }], { ...size, pins: true }) : null

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-slate-950">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">
            {option.summary ? `via ${option.summary}` : 'Route'}
          </h1>
          <p className="text-sm text-slate-400">
            {formatDuration(option.route.totalDurationS)} ·{' '}
            {formatDistance(option.route.totalDistanceM)}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 text-sm font-medium text-emerald-400">
          Done
        </button>
      </header>

      <div ref={ref} className="flex-1 overflow-hidden">
        {map ? (
          <img src={map} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500">
            {size ? 'No map available — add a Mapbox token to see the route.' : null}
          </div>
        )}
      </div>
    </div>
  )
}
