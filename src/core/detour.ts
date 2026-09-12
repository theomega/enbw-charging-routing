import type { ChargerLegs, ChargerOnRoute, LatLon } from './types'

/**
 * Detour pricing.
 *
 *   detour = [ T(origin -> charger) - T(origin -> routePoint) ]
 *          + [ T(charger -> dest)   - T(routePoint -> dest)   ]
 *
 * `routePoint` is where the charger meets the selected route — the spot you
 * drive past if you do not stop (core/route.ts). So each bracket is the same
 * journey asked twice, once ending at the charger and once at the point on the
 * road beside it, and the detour is what the excursion costs on top.
 *
 * It used to be measured against the whole journey instead:
 *
 *   detour = T(origin -> charger) + T(charger -> dest) - T(origin -> dest)
 *
 * which does not survive route alternatives. Both legs are *unconstrained* —
 * Mapbox routes them however it likes — so they are the same numbers whichever
 * alternative you have selected, while `T(origin -> dest)` is one fixed
 * baseline. A charger on the stretch two alternatives share therefore priced
 * differently depending on which one was selected, and a re-baselining fudge
 * (`routePenaltySeconds`, a whole-route constant) made that worse rather than
 * better: at the shared stretch you are on the same metre of road either way,
 * so no per-route constant can be right there.
 *
 * Anchoring on `routePoint` removes the question. Both terms now move together
 * with the selected route, and for a charger on a shared stretch the route
 * point is literally the same coordinate on both alternatives — so the detour
 * is identical, by construction rather than by cancellation. It also drops the
 * profile-mixing worry: all four durations come from the same matrix, and the
 * `driving-traffic` route never enters the arithmetic.
 *
 * Nothing here touches the network. The matrix is a parameter, so the whole
 * module is testable — and so the arithmetic stays readable next to the API
 * quota arithmetic that shapes it.
 */

/**
 * A duration matrix request, in the abstract: which points, which of them are
 * sources, which are destinations.
 */
export interface MatrixQuery {
  coordinates: LatLon[]
  sources: number[]
  destinations: number[]
}

/**
 * A matrix answer: `[source][destination]`, null where unroutable.
 *
 * `distances` is nullable as a whole because it is an annotation the provider
 * may not return; the detour is priced from `durations` either way.
 */
export interface MatrixResult {
  /** Seconds. */
  durations: (number | null)[][]
  /** Metres. */
  distances: (number | null)[][] | null
}

/** Answers a `MatrixQuery`. */
export type MatrixFn = (query: MatrixQuery, signal?: AbortSignal) => Promise<MatrixResult>

/**
 * Mapbox caps the `driving` matrix at 25 coordinates per request. This drives
 * the chunking below, so it lives with the arithmetic rather than with the
 * fetch that enforces it.
 */
export const MATRIX_MAX_COORDS = 25

/**
 * Each charger costs two coordinate slots — itself and its route point — and
 * one slot goes to the journey endpoint, so a chunk holds twelve.
 *
 * That is half what it was when only the charger needed a slot, so both costs
 * roughly double: 45 rows take eight requests instead of four, and `4k`
 * elements for `k` chargers instead of `~2k` — 180 against 92. That is the
 * price of the fix. The route point has to be measured by the same engine, on
 * the same profile, in the same call, or the subtraction is comparing two
 * different things again.
 */
export const CHARGERS_PER_CHUNK = Math.floor((MATRIX_MAX_COORDS - 1) / 2)

/**
 * A charger and the point on the route it is measured against. `priceDetours`
 * needs both for every candidate; the pairing is what keeps the two halves of
 * each matrix row aligned.
 */
export interface DetourStop {
  charger: LatLon
  routePoint: LatLon
}

/** Split candidates into chunks that fit inside one matrix request. */
export function chunkCandidates<T>(items: T[], size = CHARGERS_PER_CHUNK): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Build the two matrix requests for one chunk.
 *
 * Each request carries the chargers and their route points in two parallel
 * runs, chargers first, so column `i` and column `k + i` are the two endings of
 * the same journey and the subtraction is a pair of adjacent lookups.
 *
 * A: [origin, ...chargers, ...routePoints], sources=[0]
 *      -> origin->charger_i at i, origin->routePoint_i at k + i
 * B: [...chargers, ...routePoints, destination], destinations=[last]
 *      -> charger_i->dest at i, routePoint_i->dest at k + i
 */
export function buildChunkQueries(
  origin: LatLon,
  destination: LatLon,
  stops: DetourStop[],
): { fromOrigin: MatrixQuery; toDestination: MatrixQuery } {
  if (stops.length === 0) throw new Error('chunk must contain at least one charger')
  if (stops.length > CHARGERS_PER_CHUNK) {
    throw new Error(`chunk of ${stops.length} exceeds ${CHARGERS_PER_CHUNK}`)
  }
  const k = stops.length
  const chargers = stops.map((s) => s.charger)
  const routePoints = stops.map((s) => s.routePoint)

  return {
    fromOrigin: {
      coordinates: [origin, ...chargers, ...routePoints],
      sources: [0],
      // chargers at 1..k, route points at k+1..2k
      destinations: Array.from({ length: 2 * k }, (_, i) => i + 1),
    },
    toDestination: {
      coordinates: [...chargers, ...routePoints, destination],
      sources: Array.from({ length: 2 * k }, (_, i) => i),
      destinations: [2 * k],
    },
  }
}

/**
 * The arithmetic, isolated so it can be tested without a network.
 *
 * One function for both units: the four numbers are seconds or metres, and the
 * subtraction is the same either way. They used to differ — the duration
 * carried a whole-route penalty term and the distance had no analogue for it —
 * but anchoring on the route point removed the term, and with it the reason to
 * write the subtraction twice.
 *
 * Returns null when any of the four is unroutable, since a detour is only
 * meaningful once both endings of both journeys are known. Clamps at zero:
 * routing to the charger can come out marginally *cheaper* than routing to the
 * point on the road beside it — the route point is an arbitrary spot on the
 * carriageway and Mapbox snaps it to the network like any other coordinate —
 * and a detour of "-40 seconds" is noise reported as a discount.
 */
export function detourCost(
  toCharger: number | null | undefined,
  fromCharger: number | null | undefined,
  toRoutePoint: number | null | undefined,
  fromRoutePoint: number | null | undefined,
): number | null {
  if (toCharger == null || fromCharger == null) return null
  if (toRoutePoint == null || fromRoutePoint == null) return null
  const detour = toCharger - toRoutePoint + (fromCharger - fromRoutePoint)
  return detour < 0 ? 0 : detour
}

export interface DetourOptions {
  /** Answers the matrix queries. Injected, so this module never fetches. */
  matrix: MatrixFn
  /** How many of the nearest candidates to price. Each 12 costs 2 requests. */
  limit?: number
  signal?: AbortSignal
}

/**
 * Everything one matrix pass learns about a charger.
 *
 * The two legs are kept rather than collapsed into `detourS` alone: they cost
 * nothing extra — the same response carries them — and they are what the detail
 * panel needs to answer "how far to it" and "how far still to go afterwards"
 * with real road figures.
 */
export interface Pricing {
  detourS: number | null
  detourM: number | null
  legs: ChargerLegs
}

/**
 * Price the detour for the first `limit` candidates, which are already ordered
 * by how soon you reach them. Entries beyond the limit keep `detourS: null`
 * and the UI shows them as unpriced rather than hiding them.
 */
export async function priceDetours(
  origin: LatLon,
  destination: LatLon,
  candidates: ChargerOnRoute[],
  options: DetourOptions,
): Promise<ChargerOnRoute[]> {
  const { matrix, signal } = options
  const limit = options.limit ?? 20

  const priced = candidates.slice(0, limit)
  if (priced.length === 0) return candidates

  const chunks = chunkCandidates(priced)
  const pricings = new Map<string, Pricing>()

  for (const chunk of chunks) {
    const stops: DetourStop[] = chunk.map((c) => ({
      charger: { lat: c.charger.lat, lon: c.charger.lon },
      routePoint: c.routePoint,
    }))
    const { fromOrigin, toDestination } = buildChunkQueries(origin, destination, stops)

    const [a, b] = await Promise.all([matrix(fromOrigin, signal), matrix(toDestination, signal)])

    const k = chunk.length
    const durationsA = a.durations[0] ?? []
    const distancesA = a.distances?.[0] ?? []

    chunk.forEach((c, i) => {
      // Column i is the charger, column k + i the route point beside it.
      const toChargerS = durationsA[i] ?? null
      const toRoutePointS = durationsA[k + i] ?? null
      const fromChargerS = b.durations[i]?.[0] ?? null
      const fromRoutePointS = b.durations[k + i]?.[0] ?? null

      const toChargerM = distancesA[i] ?? null
      const toRoutePointM = distancesA[k + i] ?? null
      const fromChargerM = b.distances?.[i]?.[0] ?? null
      const fromRoutePointM = b.distances?.[k + i]?.[0] ?? null

      pricings.set(c.charger.id, {
        detourS: detourCost(toChargerS, fromChargerS, toRoutePointS, fromRoutePointS),
        detourM: detourCost(toChargerM, fromChargerM, toRoutePointM, fromRoutePointM),
        // The legs stay absolute: the detail panel asks "how far to it" and
        // "how far still to go", which are the journeys themselves, not the
        // margin over driving past.
        legs: { toChargerM, toChargerS, fromChargerM, fromChargerS },
      })
    })
  }

  return candidates.map((c) => {
    const pricing = pricings.get(c.charger.id)
    return pricing ? { ...c, ...pricing } : c
  })
}

/* ------------------------------------------------------------------ *
 * Caching
 * ------------------------------------------------------------------ */

/**
 * Detours depend only on geometry, so they survive filter toggles and
 * availability refreshes — which must never re-spend matrix requests. The
 * origin is rounded to ~100 m so small GPS jitter does not miss the cache.
 */
export function detourCacheKey(origin: LatLon, destination: LatLon, chargerId: string): string {
  const r = (n: number) => n.toFixed(3)
  return `${r(origin.lat)},${r(origin.lon)}|${r(destination.lat)},${r(destination.lon)}|${chargerId}`
}

export class DetourCache {
  private readonly entries = new Map<string, Pricing>()

  get(origin: LatLon, destination: LatLon, chargerId: string): Pricing | undefined {
    return this.entries.get(detourCacheKey(origin, destination, chargerId))
  }

  has(origin: LatLon, destination: LatLon, chargerId: string): boolean {
    return this.entries.has(detourCacheKey(origin, destination, chargerId))
  }

  set(origin: LatLon, destination: LatLon, chargerId: string, pricing: Pricing): void {
    this.entries.set(detourCacheKey(origin, destination, chargerId), pricing)
  }

  clear(): void {
    this.entries.clear()
  }
}
