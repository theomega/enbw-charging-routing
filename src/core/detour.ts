import type { ChargerLegs, ChargerOnRoute, LatLon } from './types'

/**
 * Detour pricing.
 *
 *   detour = T(origin -> charger) + T(charger -> destination)
 *            - T(origin -> destination)
 *
 * The subtraction is only valid if all three durations come from the same
 * routing profile. The headline route uses `driving-traffic` while the matrix
 * uses `driving`, so reusing the route's duration as t_direct would mix
 * profiles and produce nonsense (routinely negative). Instead t_direct is read
 * out of the same matrix call, by appending the destination as an extra target.
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

/** Origin + destination occupy two of the coordinate slots. */
export const CHARGERS_PER_CHUNK = MATRIX_MAX_COORDS - 2

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
 * A: [origin, ...chargers, destination], sources=[0] -> origin->charger_i, and
 *    origin->destination in the final column (that is t_direct).
 * B: [...chargers, destination], destinations=[last] -> charger_i->destination.
 */
export function buildChunkQueries(
  origin: LatLon,
  destination: LatLon,
  chargers: LatLon[],
): { fromOrigin: MatrixQuery; toDestination: MatrixQuery } {
  if (chargers.length === 0) throw new Error('chunk must contain at least one charger')
  if (chargers.length > CHARGERS_PER_CHUNK) {
    throw new Error(`chunk of ${chargers.length} exceeds ${CHARGERS_PER_CHUNK}`)
  }
  const k = chargers.length
  return {
    fromOrigin: {
      coordinates: [origin, ...chargers, destination],
      sources: [0],
      // chargers at 1..k, destination at k+1
      destinations: Array.from({ length: k + 1 }, (_, i) => i + 1),
    },
    toDestination: {
      coordinates: [...chargers, destination],
      sources: Array.from({ length: k }, (_, i) => i),
      destinations: [k],
    },
  }
}

/**
 * The arithmetic, isolated so it can be tested without a network.
 *
 * Returns null when either leg is unroutable; clamps at zero because a charger
 * sitting on a marginally faster alternative can price out slightly negative.
 *
 * `penaltyS` re-baselines onto the route the user actually chose. `tDirect` is
 * the *fastest* path, so without it every charger on a slower alternative
 * inherits that alternative's whole penalty — pick the Jaufenpass route and a
 * charger sitting directly on the road you are driving would read "+22 min".
 * See `routePenaltySeconds`.
 */
export function detourSeconds(
  toCharger: number | null | undefined,
  fromCharger: number | null | undefined,
  tDirect: number | null | undefined,
  penaltyS = 0,
): number | null {
  if (toCharger == null || fromCharger == null || tDirect == null) return null
  const detour = toCharger + fromCharger - tDirect - penaltyS
  return detour < 0 ? 0 : detour
}

/**
 * The same subtraction in metres.
 *
 * No `penaltyS` equivalent: re-baselining corrects for one route being slower
 * than another in *time*, which is a traffic effect. There is no distance
 * analogue — a longer alternative is longer for every charger on it, and that
 * is a true statement rather than an artefact to subtract away.
 */
export function detourMetres(
  toCharger: number | null | undefined,
  fromCharger: number | null | undefined,
  dDirect: number | null | undefined,
): number | null {
  if (toCharger == null || fromCharger == null || dDirect == null) return null
  const detour = toCharger + fromCharger - dDirect
  return detour < 0 ? 0 : detour
}

/**
 * How much slower the selected route is than the fastest one, in seconds.
 *
 * Approximate by construction: this is a `driving-traffic` delta applied to a
 * `driving` baseline in `detourSeconds`. Mixing profiles in an absolute value
 * produces nonsense (see the t_direct note above), but applying the difference
 * between two same-profile routes as a correction is far better behaved — and
 * it is exactly zero in the default case, where the fastest route is selected.
 */
export function routePenaltySeconds(selectedDurationS: number, fastestDurationS: number): number {
  const penalty = selectedDurationS - fastestDurationS
  return penalty > 0 ? penalty : 0
}

export interface DetourOptions {
  /** Answers the matrix queries. Injected, so this module never fetches. */
  matrix: MatrixFn
  /** How many of the nearest candidates to price. Each 23 costs 2 requests. */
  limit?: number
  /**
   * Seconds by which the selected route is slower than the fastest one, from
   * `routePenaltySeconds`. Zero when the fastest route is selected.
   */
  penaltyS?: number
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
  const penaltyS = options.penaltyS ?? 0

  const priced = candidates.slice(0, limit)
  if (priced.length === 0) return candidates

  const chunks = chunkCandidates(priced)
  const pricings = new Map<string, Pricing>()

  // t_direct is the same journey for every chunk; take it from the first chunk
  // that returns a usable value and reuse it, so chunk boundaries cannot make
  // two otherwise-identical chargers disagree. The same argument applies to the
  // direct distance.
  let tDirect: number | null = null
  let dDirect: number | null = null

  for (const chunk of chunks) {
    const points = chunk.map((c) => ({ lat: c.charger.lat, lon: c.charger.lon }))
    const { fromOrigin, toDestination } = buildChunkQueries(origin, destination, points)

    const [a, b] = await Promise.all([matrix(fromOrigin, signal), matrix(toDestination, signal)])

    const durationsA = a.durations[0] ?? []
    const distancesA = a.distances?.[0] ?? []
    if (tDirect == null) tDirect = durationsA[chunk.length] ?? null
    if (dDirect == null) dDirect = distancesA[chunk.length] ?? null

    chunk.forEach((c, i) => {
      const toChargerS = durationsA[i] ?? null
      const fromChargerS = b.durations[i]?.[0] ?? null
      const toChargerM = distancesA[i] ?? null
      const fromChargerM = b.distances?.[i]?.[0] ?? null

      pricings.set(c.charger.id, {
        detourS: detourSeconds(toChargerS, fromChargerS, tDirect, penaltyS),
        detourM: detourMetres(toChargerM, fromChargerM, dDirect),
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
