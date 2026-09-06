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
 * to happen server-side.
 *
 * It used to do much more: the app discovered chargers by tiling a route
 * corridor, so this file carried a fan-out with cluster subdivision, depth
 * caps, subrequest budgets and truncation reporting — a measured 907 upstream
 * requests for one 743 km route. The station list is now generated offline
 * (`scripts/build-station-list.mjs`), so all that is gone.
 *
 * It then asked for small bounding boxes around the stations the client wanted.
 * That is gone too. A box is answered through EnBW's clustering grid, which
 * collapses any grid cell holding two stations into a placeholder carrying no
 * id and no occupancy — and measured on a real route, a box never covered more
 * than one candidate anyway (17 stations, 17 boxes). Asking for one station by
 * id costs the same number of requests and cannot cluster.
 *
 * Typically 17-20 requests per search, well inside Cloudflare's free-plan limit
 * of 50 subrequests per invocation.
 */

import type { OccupancyRecord } from '../src/services/enbw/availability'
import type { EnbwStation } from '../src/services/enbw/wire'

export interface Env {
  ENBW_SUBSCRIPTION_KEY: string
}

const ENBW_BASE = 'https://api.emp.emob-enbw.com/emobility-public-api/api/v1/chargestations'
/** The only Origin the upstream accepts. */
const REQUIRED_ORIGIN = 'https://www.enbw.com'

/** Occupancy is live data, so cache only long enough to absorb retries. */
const CACHE_TTL_SECONDS = 60
/** Cloudflare allows 6 simultaneous outgoing connections per invocation. */
const MAX_CONCURRENCY = 6
/**
 * Well above what a route needs (~17-20 stations) and comfortably under the
 * free plan's 50-subrequest ceiling.
 */
const MAX_STATIONS = 60

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
    if (url.pathname !== '/api/chargers') return json({ error: 'Not found' }, 404)
    if (request.method !== 'POST') return json({ error: 'Use POST' }, 405)
    if (!env.ENBW_SUBSCRIPTION_KEY) {
      return json({ error: 'ENBW_SUBSCRIPTION_KEY is not configured' }, 500)
    }

    let stationIds: number[]
    try {
      const body = (await request.json()) as { stationIds?: unknown }
      stationIds = validateStationIds(body.stationIds)
    } catch (err) {
      return json({ error: (err as Error).message }, 400)
    }

    try {
      const stations = await fetchOccupancy(stationIds, env, ctx)
      return json({ stations, fetchedAt: new Date().toISOString() })
    } catch (err) {
      return json({ error: `Upstream request failed: ${(err as Error).message}` }, 502)
    }
  },
}

function validateStationIds(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('stationIds must be a non-empty array')
  }
  if (raw.length > MAX_STATIONS) throw new Error(`too many stations (max ${MAX_STATIONS})`)

  return raw.map((id, i) => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new Error(`stationIds[${i}] must be a positive integer`)
    }
    return id
  })
}

/** Fetch every station with bounded concurrency. */
async function fetchOccupancy(
  stationIds: number[],
  env: Env,
  ctx: ExecutionContext,
): Promise<OccupancyRecord[]> {
  const out: OccupancyRecord[] = []
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= stationIds.length) return
      const station = await fetchStation(stationIds[i], env, ctx)
      // A 404 is not an error. EnBW re-issues station ids in bulk, so a list a
      // few days old always has some. The client already knows the address and
      // the point count from that list, so an absent id costs only the badge.
      if (station) out.push(station)
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, stationIds.length) }, worker))
  return out
}

/**
 * One station's occupancy, or null if EnBW no longer has that id.
 *
 * Trimmed to the counts before it leaves this file: an upstream record averages
 * 3.8 KB (a big hub is 24 KB) and carries the whole charge-point array, none of
 * which the client needs — it has the address, power and point count from the
 * shipped list already.
 */
async function fetchStation(
  stationId: number,
  env: Env,
  ctx: ExecutionContext,
): Promise<OccupancyRecord | null> {
  const upstream = `${ENBW_BASE}/${stationId}`

  // Cache on the URL alone; the key header must never become part of the key.
  const cacheKey = new Request(upstream, { method: 'GET' })
  const cache = caches.default
  const cached = await cache.match(cacheKey)
  if (cached) return (await cached.json()) as OccupancyRecord

  const res = await fetch(upstream, {
    headers: {
      'Ocp-Apim-Subscription-Key': env.ENBW_SUBSCRIPTION_KEY,
      Origin: REQUIRED_ORIGIN,
      Referer: `${REQUIRED_ORIGIN}/`,
      Accept: 'application/json',
    },
  })

  if (res.status === 404) return null
  if (!res.ok) {
    const hint =
      res.status === 403
        ? ' (403 usually means the Origin gate changed or the key was rotated)'
        : ''
    throw new Error(`EnBW returned ${res.status} for station ${stationId}${hint}`)
  }

  const station = (await res.json()) as EnbwStation
  if (typeof station?.stationId !== 'number') {
    throw new Error('EnBW returned an unexpected payload')
  }

  const occupancy: OccupancyRecord = {
    stationId: station.stationId,
    availablePoints: station.availableChargePoints ?? 0,
    unknownPoints: station.unknownStateChargePoints ?? 0,
    // Omitted rather than zeroed: the client's list knows the real total, and
    // "0 points" would render as a nonsense denominator.
    ...(station.numberOfChargePoints != null ? { totalPoints: station.numberOfChargePoints } : {}),
  }

  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(JSON.stringify(occupancy), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `max-age=${CACHE_TTL_SECONDS}`,
        },
      }),
    ),
  )
  return occupancy
}

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
