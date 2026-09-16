import type { ChargerOnRoute, LatLon } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { formatDistance, formatDuration } from './format'
import { RouteMap } from './RouteMap'

/**
 * The chosen route, with the whole screen and every gesture.
 *
 * The picker's map answers "which of these?"; this one answers the question
 * that comes later, halfway down the charger list — "wait, does this thing
 * really go the way I think it does?". That question is usually about one
 * junction or one pass, so the answer needs zoom, which is the whole reason
 * this is a live map and not a picture.
 *
 * Only the selected route is drawn: the alternatives are noise once the choice
 * is made, and the lines they would add are lines the driver already rejected.
 */
export function RouteMapSheet({
  option,
  chargers,
  onSelectCharger,
  position,
  drivenM = 0,
  drivenS = 0,
  onClose,
}: {
  option: RouteOption
  chargers: ChargerOnRoute[]
  /** Tapping a charger dot closes this sheet and opens that charger's row. */
  onSelectCharger?: (chargerId: string) => void
  position: LatLon | null
  /** Already driven along this route, so the caption reads as what is left. */
  drivenM?: number
  drivenS?: number
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-slate-950">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 p-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">
            {option.summary ? `via ${option.summary}` : 'Route'}
          </h1>
          <p className="text-sm text-slate-400">
            {formatDuration(Math.max(0, option.route.totalDurationS - drivenS))} ·{' '}
            {formatDistance(Math.max(0, option.route.totalDistanceM - drivenM))}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 text-sm font-medium text-emerald-400">
          Zurück
        </button>
      </header>

      {/* Owns the viewport, so one finger pans: no cooperative gestures here. */}
      <RouteMap
        routes={[option]}
        selectedId={option.id}
        chargers={chargers}
        onSelectCharger={onSelectCharger}
        position={position}
        padding={48}
        className="flex-1"
      />
    </div>
  )
}
