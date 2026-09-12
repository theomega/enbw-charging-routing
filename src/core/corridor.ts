import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import buffer from '@turf/buffer'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { toPoint } from './geo'
import { buildRouteGeometry, type Route, type RouteGeometry } from './route'
import type { Charger, ChargerOnRoute, LatLon } from './types'

/**
 * The free half of the feature: everything here runs in the browser at zero API
 * cost, which is why every charger in the corridor gets a distance and a time
 * while only the first handful get a priced detour.
 *
 * Two steps, both Turf:
 *
 *   1. `buffer` the route into a corridor polygon and keep the chargers inside
 *      it — a cheap gate that rejects the overwhelming majority of the shipped
 *      station list, which is nowhere near this route.
 *   2. `nearestPointOnLine` for the survivors, which is what actually decides
 *      where along the route a charger sits (see core/route.ts).
 *
 * Step 1 exists only to keep step 2 off 4,600 stations. It never decides the
 * answer: the exact `offsetM` from step 2 is what admits a charger, so a buffer
 * that is slightly generous costs a little time and changes no result.
 */

/**
 * Corridor half-width: chargers further than this off the route are not worth
 * a stop.
 *
 * 10 km rather than a tighter figure because "off the route" is measured
 * against the geometry, not against driving time. A motorway running one side
 * of a valley leaves a charger on the other side several kilometres away in a
 * straight line while costing only a few minutes to reach — the detour column
 * is what prices that properly, and it can only price rows that got this far.
 */
export const DEFAULT_MAX_OFFSET_M = 10_000

/**
 * How much wider than the corridor the gate polygon is drawn.
 *
 * `buffer` approximates the rounded ends and corners with straight chords,
 * which fall *inside* the true circle — up to ~0.5% of the radius. Widening by
 * 2% guarantees the gate is a superset of the corridor, so no charger the exact
 * test would have kept is thrown away before it is measured.
 */
const GATE_MARGIN = 1.02

export interface Corridor {
  geometry: RouteGeometry
  maxOffsetM: number
  /**
   * The corridor as a polygon, `maxOffsetM` either side of the route.
   * Null if Turf could not buffer the geometry, in which case the gate is
   * simply skipped and every charger goes to the exact test.
   */
  area: Feature<Polygon | MultiPolygon> | null
  /** Cheap "worth measuring?" gate. A superset of the true corridor. */
  admits(point: LatLon): boolean
}

export function buildCorridor(route: Route, maxOffsetM = DEFAULT_MAX_OFFSET_M): Corridor {
  const geometry = buildRouteGeometry(route)
  const area = geometry.line
    ? (buffer(geometry.line, (maxOffsetM * GATE_MARGIN) / 1000, { units: 'kilometers' }) ?? null)
    : null

  return {
    geometry,
    maxOffsetM,
    area,
    admits: (point) => (area ? booleanPointInPolygon(toPoint(point), area) : true),
  }
}

export interface PlacementOptions {
  /** Called with 0..1 as chargers are examined, for the progress bar. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /** Chargers examined between yields to the event loop. */
  chunkSize?: number
}

/**
 * Place every charger on the route, drop the ones outside the corridor, and
 * order the rest by how soon you reach them.
 *
 * Async because it is not cheap — a few hundred milliseconds on a laptop for a
 * 300 km route, a second or two on a phone — and a frozen list with no
 * explanation is worse than a slower one that says what it is doing. The loop
 * hands the main thread back every `chunkSize` chargers so React can paint the
 * progress bar.
 */
export async function placeChargersOnRoute(
  corridor: Corridor,
  chargers: Charger[],
  options: PlacementOptions = {},
): Promise<ChargerOnRoute[]> {
  const { onProgress, signal } = options
  const chunkSize = options.chunkSize ?? 200

  const placed: ChargerOnRoute[] = []
  onProgress?.(0)

  for (let i = 0; i < chargers.length; i++) {
    if (signal?.aborted) throw new DOMException('Placement aborted', 'AbortError')

    const charger = chargers[i]
    if (corridor.admits(charger)) {
      const projection = corridor.geometry.project(charger)
      if (projection.offsetM <= corridor.maxOffsetM) {
        placed.push({
          charger,
          alongDistanceM: projection.alongDistanceM,
          alongDurationS: projection.alongDurationS,
          offsetM: projection.offsetM,
          routePoint: projection.point,
          // Everything the Matrix pays for starts out unknown; `core/detour.ts`
          // fills these in for the rows that get priced.
          detourS: null,
          detourM: null,
          legs: null,
        })
      }
    }

    if ((i + 1) % chunkSize === 0 && i + 1 < chargers.length) {
      onProgress?.((i + 1) / chargers.length)
      await yieldToUi()
    }
  }

  onProgress?.(1)
  placed.sort((a, b) => a.alongDistanceM - b.alongDistanceM)
  return placed
}

/**
 * A macrotask, not a microtask: `await Promise.resolve()` would drain straight
 * back into this loop without ever letting the browser render.
 */
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
