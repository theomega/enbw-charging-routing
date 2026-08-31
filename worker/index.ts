/**
 * Cloudflare Worker: the EnBW proxy.
 *
 * This exists for one specific reason. EnBW's gateway *looks* browser-callable
 * — the CORS preflight answers `access-control-allow-origin: *` and allows the
 * subscription-key header — but the actual GET is gated on the `Origin` header:
 *
 *     Origin: https://www.enbw.com  -> 200
 *     Origin: http://localhost:5173 -> 403 forbidden
 *
 * Browsers set `Origin` themselves and JS cannot override it, so the call has
 * to happen server-side. The Worker also does the tile fan-out, which keeps a
 * phone on a slow connection down to a single request.
 */

import type { EnbwStation } from '../src/providers/enbw'

export interface Env {
  ENBW_SUBSCRIPTION_KEY: string
}

interface Tile {
  fromLat: number
  toLat: number
  fromLon: number
  toLon: number
}

const ENBW_BASE = 'https://api.emp.emob-enbw.com/emobility-public-api/api/v1/chargestations'
/** The only Origin the upstream accepts. */
const REQUIRED_ORIGIN = 'https://www.enbw.com'

/** Availability is live data, so cache only long enough to absorb retries. */
const CACHE_TTL_SECONDS = 60
/** Stay well clear of the Workers subrequest limit and of upstream rate limits. */
const MAX_CONCURRENCY = 6
const MAX_TILES = 120

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
    if (url.pathname !== '/api/chargers') return json({ error: 'Not found' }, 404)
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)
    if (!env.ENBW_SUBSCRIPTION_KEY) {
      return json({ error: 'ENBW_SUBSCRIPTION_KEY is not configured' }, 500)
    }

    let tiles: Tile[]
    try {
      const body = (await request.json()) as { tiles?: unknown }
      tiles = validateTiles(body.tiles)
    } catch (err) {
      return json({ error: (err as Error).message }, 400)
    }

    try {
      const stations = await fetchTiles(tiles, env, ctx)
      return json({ stations, tileCount: tiles.length, fetchedAt: new Date().toISOString() })
    } catch (err) {
      return json({ error: `Upstream request failed: ${(err as Error).message}` }, 502)
    }
  },
}

function validateTiles(raw: unknown): Tile[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('tiles must be a non-empty array')
  if (raw.length > MAX_TILES) throw new Error(`too many tiles (max ${MAX_TILES})`)
  return raw.map((t, i) => {
    const tile = t as Record<string, unknown>
    for (const k of ['fromLat', 'toLat', 'fromLon', 'toLon']) {
      if (typeof tile[k] !== 'number' || !Number.isFinite(tile[k])) {
        throw new Error(`tile ${i}: ${k} must be a finite number`)
      }
    }
    const out = tile as unknown as Tile
    if (out.fromLat >= out.toLat || out.fromLon >= out.toLon) {
      throw new Error(`tile ${i}: from* must be less than to*`)
    }
    return out
  })
}

/**
 * Fan out over tiles with bounded concurrency, then merge.
 *
 * A tile that comes back with cluster placeholders is retried once as four
 * quarter-tiles: EnBW clusters based on how large the bbox is, so subdividing
 * is what actually resolves individual stations.
 */
async function fetchTiles(tiles: Tile[], env: Env, ctx: ExecutionContext): Promise<EnbwStation[]> {
  const byId = new Map<number, EnbwStation>()
  const queue = [...tiles]
  const retried = new Set<string>()

  const worker = async (): Promise<void> => {
    for (;;) {
      const tile = queue.shift()
      if (!tile) return
      const stations = await fetchTile(tile, env, ctx)
      let sawCluster = false
      for (const s of stations) {
        if (s.grouped) {
          sawCluster = true
          continue
        }
        // Tiles overlap by design, so the same station arrives repeatedly.
        if (!byId.has(s.stationId)) byId.set(s.stationId, s)
      }
      const key = tileKey(tile)
      if (sawCluster && !retried.has(key) && queue.length + 4 <= MAX_TILES * 4) {
        retried.add(key)
        queue.push(...subdivide(tile))
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, tiles.length) }, worker))
  return [...byId.values()]
}

async function fetchTile(tile: Tile, env: Env, ctx: ExecutionContext): Promise<EnbwStation[]> {
  const upstream = new URL(ENBW_BASE)
  upstream.searchParams.set('fromLat', String(tile.fromLat))
  upstream.searchParams.set('toLat', String(tile.toLat))
  upstream.searchParams.set('fromLon', String(tile.fromLon))
  upstream.searchParams.set('toLon', String(tile.toLon))
  upstream.searchParams.set('grouping', 'false')
  upstream.searchParams.set('groupingDivisor', '15')

  // Cache on the URL alone; the key header must never become part of the key.
  const cacheKey = new Request(upstream.toString(), { method: 'GET' })
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return (await cached.json()) as EnbwStation[]

  const res = await fetch(upstream.toString(), {
    headers: {
      'Ocp-Apim-Subscription-Key': env.ENBW_SUBSCRIPTION_KEY,
      Origin: REQUIRED_ORIGIN,
      Referer: `${REQUIRED_ORIGIN}/`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const hint =
      res.status === 403
        ? ' (403 usually means the Origin gate changed or the key was rotated)'
        : ''
    throw new Error(`EnBW returned ${res.status}${hint}`)
  }

  const stations = (await res.json()) as EnbwStation[]
  if (!Array.isArray(stations)) throw new Error('EnBW returned an unexpected payload')

  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(JSON.stringify(stations), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `max-age=${CACHE_TTL_SECONDS}`,
        },
      }),
    ),
  )
  return stations
}

/** Split a tile into quarters to break up EnBW's clustering. */
function subdivide(tile: Tile): Tile[] {
  const midLat = (tile.fromLat + tile.toLat) / 2
  const midLon = (tile.fromLon + tile.toLon) / 2
  return [
    { fromLat: tile.fromLat, toLat: midLat, fromLon: tile.fromLon, toLon: midLon },
    { fromLat: tile.fromLat, toLat: midLat, fromLon: midLon, toLon: tile.toLon },
    { fromLat: midLat, toLat: tile.toLat, fromLon: tile.fromLon, toLon: midLon },
    { fromLat: midLat, toLat: tile.toLat, fromLon: midLon, toLon: tile.toLon },
  ]
}

const tileKey = (t: Tile) =>
  `${t.fromLat.toFixed(5)},${t.toLat.toFixed(5)},${t.fromLon.toFixed(5)},${t.toLon.toFixed(5)}`

const corsHeaders = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  })
}
