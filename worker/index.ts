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
 * to happen server-side. Holding the subscription key off the client is the
 * second reason, but the Origin gate is the one that makes a proxy unavoidable.
 *
 * It used to do much more: the app discovered chargers by tiling a route
 * corridor, so this file carried a fan-out with cluster subdivision, depth
 * caps, subrequest budgets and truncation reporting — a measured 907 upstream
 * requests for one 743 km route. The station list is now generated offline
 * (`scripts/build-station-list.mjs`), so all that is gone.
 *
 * It then took a batch of station ids and fetched them here, six at a time.
 * That is gone too, and the reason is the shape of Cloudflare's limits: the
 * free plan allows 50 subrequests *per invocation*, so batching N stations into
 * one request made N compete for a single budget and capped a search at 48
 * rows. One station per invocation spends one subrequest against its own
 * budget, so the ceiling stops existing and the client decides how many rows
 * are worth enriching. Fanning out from the browser also lets rows fail — and
 * arrive — independently, which no amount of care in here could reproduce.
 *
 * What is left is a single station lookup with no batching, no concurrency
 * control and no cache. It should stay that way.
 *
 *     GET /api/chargers/:stationId  ->  200 the trimmed record
 *                                       404 EnBW no longer has that id
 *                                       502 upstream refused
 */

import type { LiveStationRecord } from '../src/services/enbw/availability'
import type { EnbwChargePoint, EnbwStation } from '../src/services/enbw/wire'

export interface Env {
  ENBW_SUBSCRIPTION_KEY: string
}

const ENBW_BASE = 'https://api.emp.emob-enbw.com/emobility-public-api/api/v1/chargestations'
/** The only Origin the upstream accepts. */
const REQUIRED_ORIGIN = 'https://www.enbw.com'

const ROUTE = /^\/api\/chargers\/(\d+)$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const match = ROUTE.exec(new URL(request.url).pathname)
    if (!match) return json({ error: 'Not found' }, 404)
    if (request.method !== 'GET') return json({ error: 'Use GET' }, 405)
    if (!env.ENBW_SUBSCRIPTION_KEY) {
      return json({ error: 'ENBW_SUBSCRIPTION_KEY is not configured' }, 500)
    }

    // The route pattern already guarantees digits; this only rejects the ones
    // too large to survive the round trip through a JSON number.
    const stationId = Number(match[1])
    if (!Number.isSafeInteger(stationId) || stationId <= 0) {
      return json({ error: 'stationId must be a positive integer' }, 400)
    }

    try {
      const station = await fetchStation(stationId, env)
      // A 404 is not a failure. EnBW re-issues station ids in bulk, so a list a
      // few days old always has some. The client already knows the address and
      // the point count from the shipped list, so an absent id costs only the
      // extras and the row still renders.
      if (!station) return json({ error: `No station ${stationId}` }, 404)
      return json(station)
    } catch (err) {
      return json({ error: `Upstream request failed: ${(err as Error).message}` }, 502)
    }
  },
}

/**
 * One station's live record, or null if EnBW no longer has that id.
 *
 * Trimmed before it leaves this file. The upstream record is 3-9 KB and most of
 * it is noise the client can never use — `viewPort`, `favorite`,
 * `hiddenWithActiveProfile`, per-connector cable flags, the address and power
 * the shipped list already carries. What is kept is what the detail panel
 * renders, which is roughly a fifth of that.
 *
 * `pricingInfo` and `authenticationMethods` are dropped here on purpose rather
 * than for size: both depend on the driver's own tariff, so passing them on
 * would let the panel quote a price that is wrong for most people.
 */
async function fetchStation(stationId: number, env: Env): Promise<LiveStationRecord | null> {
  const res = await fetch(`${ENBW_BASE}/${stationId}`, {
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

  return {
    stationId: station.stationId,
    availablePoints: station.availableChargePoints ?? 0,
    unknownPoints: station.unknownStateChargePoints ?? 0,
    // Omitted rather than zeroed: the client's list knows the real total, and
    // "0 points" would render as a nonsense denominator.
    ...(station.numberOfChargePoints != null ? { totalPoints: station.numberOfChargePoints } : {}),
    operatorCode: station.operatorCode ?? null,
    alwaysOpen: station.alwaysOpen ?? null,
    // `additionalInfo` is deliberately dropped: the shipped station list
    // carries the location line, and the client heads every row with that.
    chargePoints: trimChargePoints(station.chargePoints),
  }
}

/**
 * The charge-point array, reduced to what a driver reads.
 *
 * A point's connectors are collapsed into a plug list and one power figure:
 * every station measured had exactly one connector per point, and where there
 * are several they are alternative cables on the same stall, so the point can
 * deliver the highest of them and not their sum.
 */
function trimChargePoints(points: EnbwChargePoint[] | null | undefined) {
  if (!Array.isArray(points)) return null
  return points.map((point) => {
    const connectors = point.connectors ?? []
    const powers = connectors.map((c) => c.maxPowerInKw).filter((kw): kw is number => kw != null)
    return {
      id: point.evseId ?? null,
      status: point.status ?? null,
      plugs: connectors.map((c) => c.plugTypeName).filter((n): n is string => !!n),
      maxPowerKw: powers.length > 0 ? Math.max(...powers) : null,
    }
  })
}

/**
 * A plain GET with no custom headers is a CORS-simple request, so there is no
 * preflight to answer and no `OPTIONS` branch below. Keep it that way: adding a
 * request header on the client side would quietly reintroduce one.
 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  })
}
