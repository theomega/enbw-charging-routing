import type { Charger, ChargerOnRoute, LatLon, Tile } from '../providers/types'

/**
 * The local half of the feature: everything here runs in the browser at zero
 * API cost. Given a route and a set of chargers it answers "how far along my
 * route is this, in km and minutes, and how far off the road does it sit?".
 *
 * The route starts at your GPS position, so cumulative distance from the route
 * start *is* distance from you.
 */

const EARTH_RADIUS_M = 6_371_000

export interface Route {
  /** Route vertices in [lon, lat] order, as Mapbox GeoJSON returns them. */
  coordinates: [number, number][]
  /** Metres per segment; length is coordinates.length - 1. */
  distances: number[]
  /** Seconds per segment; length is coordinates.length - 1. */
  durations: number[]
  /** Whole-route totals, straight from Mapbox. */
  totalDistanceM: number
  totalDurationS: number
}

/** Prefix sums so any vertex index converts to distance/time in O(1). */
export interface RouteIndex {
  route: Route
  cumDistance: number[]
  cumDuration: number[]
}

export function buildRouteIndex(route: Route): RouteIndex {
  const n = route.coordinates.length
  const cumDistance = new Array<number>(n).fill(0)
  const cumDuration = new Array<number>(n).fill(0)
  for (let i = 1; i < n; i++) {
    cumDistance[i] = cumDistance[i - 1] + (route.distances[i - 1] ?? 0)
    cumDuration[i] = cumDuration[i - 1] + (route.durations[i - 1] ?? 0)
  }
  return { route, cumDistance, cumDuration }
}

/**
 * Local equirectangular projection.
 *
 * Accurate to well under 0.1% over the few kilometres we ever measure, and far
 * cheaper than haversine when projecting hundreds of chargers onto thousands of
 * segments. `lat0` anchors the longitude scaling.
 */
function project(lat: number, lon: number, lat0: number): { x: number; y: number } {
  const rad = Math.PI / 180
  return {
    x: EARTH_RADIUS_M * lon * rad * Math.cos(lat0 * rad),
    y: EARTH_RADIUS_M * lat * rad,
  }
}

/** Great-circle distance in metres. Used where accuracy beats speed. */
export function haversineM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

export interface Projection {
  /** Index of the segment the point falls on. */
  segmentIndex: number
  /** Position along that segment, 0..1. */
  t: number
  /** Crow-fly metres from the point to the route. */
  offsetM: number
  alongDistanceM: number
  alongDurationS: number
}

/**
 * Project a point onto the route, returning where along it that lands.
 *
 * Projects onto each *segment* rather than snapping to the nearest vertex:
 * motorway geometry can put a kilometre between vertices, and snapping would
 * quantise the "how far away" figure to that spacing.
 */
export function projectOntoRoute(index: RouteIndex, point: LatLon): Projection {
  const { coordinates } = index.route
  if (coordinates.length === 0) {
    throw new Error('Cannot project onto an empty route')
  }
  if (coordinates.length === 1) {
    const [lon, lat] = coordinates[0]
    return {
      segmentIndex: 0,
      t: 0,
      offsetM: haversineM(point, { lat, lon }),
      alongDistanceM: 0,
      alongDurationS: 0,
    }
  }

  const lat0 = point.lat
  const p = project(point.lat, point.lon, lat0)

  let bestSegment = 0
  let bestT = 0
  let bestDistSq = Infinity

  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = project(coordinates[i][1], coordinates[i][0], lat0)
    const b = project(coordinates[i + 1][1], coordinates[i + 1][0], lat0)
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lenSq = abx * abx + aby * aby

    // Degenerate segment (duplicate coordinates) — treat as the vertex itself.
    let t = lenSq === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
    t = t < 0 ? 0 : t > 1 ? 1 : t

    const dx = p.x - (a.x + t * abx)
    const dy = p.y - (a.y + t * aby)
    const distSq = dx * dx + dy * dy

    if (distSq < bestDistSq) {
      bestDistSq = distSq
      bestSegment = i
      bestT = t
    }
  }

  return {
    segmentIndex: bestSegment,
    t: bestT,
    offsetM: Math.sqrt(bestDistSq),
    alongDistanceM:
      index.cumDistance[bestSegment] + bestT * (index.route.distances[bestSegment] ?? 0),
    alongDurationS:
      index.cumDuration[bestSegment] + bestT * (index.route.durations[bestSegment] ?? 0),
  }
}

export interface CorridorOptions {
  /** Discard chargers further than this from the route. */
  maxOffsetM?: number
}

/**
 * Place every charger on the route and drop the ones outside the corridor.
 * Result is ordered by how soon you reach them.
 */
export function placeChargersOnRoute(
  index: RouteIndex,
  chargers: Charger[],
  options: CorridorOptions = {},
): ChargerOnRoute[] {
  const maxOffsetM = options.maxOffsetM ?? 5_000
  const out: ChargerOnRoute[] = []
  for (const charger of chargers) {
    const p = projectOntoRoute(index, charger)
    if (p.offsetM > maxOffsetM) continue
    out.push({
      charger,
      alongDistanceM: p.alongDistanceM,
      alongDurationS: p.alongDurationS,
      offsetM: p.offsetM,
      detourS: null,
    })
  }
  out.sort((a, b) => a.alongDistanceM - b.alongDistanceM)
  return out
}

/* ------------------------------------------------------------------ *
 * Tile generation
 * ------------------------------------------------------------------ */

export interface TileOptions {
  /** Distance between polyline samples, metres. */
  sampleSpacingM?: number
  /** Tile height in degrees of latitude. */
  tileSpanLatDeg?: number
  /** Cap on tiles produced, to bound the Worker fan-out on long routes. */
  maxTiles?: number
}

/**
 * Walk the route and emit a bounding box around it every `sampleSpacingM`.
 *
 * Tile size is a real trade-off, measured against the live API: EnBW returns
 * cluster placeholders instead of stations when the bbox is too big (0.15° gave
 * 130 clusters out of 161 rows; 0.01° gave 11 real stations out of 13). ~0.06°
 * of latitude keeps most rows resolved while covering ground quickly, and the
 * Worker subdivides any tile that still clusters.
 *
 * Longitude span is widened by 1/cos(lat) so tiles stay roughly square on the
 * ground rather than narrowing as you go north.
 */
export function tilesForRoute(route: Route, options: TileOptions = {}): Tile[] {
  const spacing = options.sampleSpacingM ?? 4_000
  const spanLat = options.tileSpanLatDeg ?? 0.06
  const maxTiles = options.maxTiles ?? 120

  const samples = sampleRoute(route, spacing)
  if (samples.length === 0) return []

  // Long routes would blow past the tile cap, so thin the samples evenly rather
  // than truncating — the far end of a route matters as much as the near end.
  //
  // Striding alone drops the final sample whenever it does not land on the
  // stride, which would leave the destination unscanned. Reserve a slot for it
  // in the stride, then re-add it. maxTiles is a hard cap (the Worker rejects
  // oversized requests), so trim defensively for tiny caps where the reserved
  // slot is not enough.
  const budget = Math.max(1, maxTiles)
  const stride = Math.max(1, Math.ceil(samples.length / Math.max(1, budget - 1)))
  const picked = samples.filter((_, i) => i % stride === 0)
  const lastSample = samples[samples.length - 1]
  if (picked[picked.length - 1] !== lastSample) picked.push(lastSample)
  if (picked.length > budget) picked.splice(budget - 1, picked.length - budget)

  const seen = new Set<string>()
  const tiles: Tile[] = []
  for (const s of picked) {
    const halfLat = spanLat / 2
    // Guard against cos -> 0 near the poles; irrelevant in Germany but cheap.
    const cos = Math.max(0.2, Math.cos((s.lat * Math.PI) / 180))
    const halfLon = halfLat / cos

    const tile: Tile = {
      fromLat: round6(s.lat - halfLat),
      toLat: round6(s.lat + halfLat),
      fromLon: round6(s.lon - halfLon),
      toLon: round6(s.lon + halfLon),
    }
    const key = `${tile.fromLat},${tile.toLat},${tile.fromLon},${tile.toLon}`
    if (seen.has(key)) continue
    seen.add(key)
    tiles.push(tile)
  }
  return tiles
}

/**
 * Points along the route at roughly `spacing` metres apart. Always includes the
 * first and last vertex so neither end of the route is left uncovered.
 */
export function sampleRoute(route: Route, spacing: number): LatLon[] {
  const coords = route.coordinates
  if (coords.length === 0) return []
  const first = { lat: coords[0][1], lon: coords[0][0] }
  if (coords.length === 1) return [first]

  const out: LatLon[] = [first]
  let sinceLast = 0
  for (let i = 0; i < coords.length - 1; i++) {
    sinceLast += route.distances[i] ?? 0
    if (sinceLast >= spacing) {
      out.push({ lat: coords[i + 1][1], lon: coords[i + 1][0] })
      sinceLast = 0
    }
  }
  const last = coords[coords.length - 1]
  const lastPoint = { lat: last[1], lon: last[0] }
  const prev = out[out.length - 1]
  if (prev.lat !== lastPoint.lat || prev.lon !== lastPoint.lon) out.push(lastPoint)
  return out
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
