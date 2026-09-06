#!/usr/bin/env node
/**
 * Build the static EnBW station list.
 *
 * The app no longer discovers chargers at runtime. It ships with a list of
 * every EnBW-tariff station and asks the API only about the occupancy of the
 * handful it displays. This script produces that list.
 *
 * Strategy: adaptive quadtree. EnBW returns cluster placeholders instead of
 * stations when a bounding box is too large, which is normally a nuisance — here
 * it is the search heuristic. A box that reports clusters contains stations and
 * is worth splitting; a box that reports none is done. Empty countryside falls
 * out of the search almost immediately.
 *
 *   pnpm build:stations                    # default root: DE + AT + northern IT
 *   pnpm build:stations -- --bbox 48.3,49.3,8.7,9.7   # a small region, for testing
 *   pnpm build:stations -- --out public/stations.enbw.json
 *
 * Requires ENBW_SUBSCRIPTION_KEY, from .dev.vars or the environment.
 */

import { writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const API = 'https://api.emp.emob-enbw.com/emobility-public-api/api/v1/chargestations'
/** The only Origin the upstream accepts; see README. */
const REQUIRED_ORIGIN = 'https://www.enbw.com'

/** EnBW's own tariff. Includes ITSMA / ATSMA / DEODR / DESMA, not just DEEBW. */
const ENBW_PRICE_GROUP = 'ENBW_GROUP'

/**
 * The undocumented parameter that makes this script cheap.
 *
 * There is no listing endpoint. The API exposes only the bounding-box query and
 * `/chargestations/{id}` — confirmed by reading EnBW's own map client, which
 * uses exactly those two and nothing else. But `priceGroups` filters
 * server-side, and that changes everything: the response then contains only
 * EnBW stations, so the clustering that forced a deep blind descent mostly
 * stops happening.
 *
 * Measured over the same 0.3° x 0.4° region:
 *   unfiltered  646 requests -> 201 stations, 4 clusters never resolved
 *   filtered     69 requests -> 202 stations, fully converged
 *
 * Cheaper *and* more complete — the unfiltered scan's own clustering had been
 * hiding a station from us.
 */
const PRICE_GROUP_FILTER = 'ENBW_GROUP'

/**
 * Minimum charging power, in kW, for a station to be worth shipping.
 *
 * This app is for finding a charge on a long drive, where an 11 or 22 kW AC
 * post is not a stop anyone would make — it is an overnight charger. Filtering
 * here rather than in the UI is the point: half the EnBW network is below this
 * line, so dropping it halves the file the phone downloads and halves the
 * geometry the corridor has to run.
 *
 * It is sent to the API as `minPower`, which is undocumented but filters
 * server-side — and, exactly like `priceGroups`, that is worth far more than
 * the bandwidth it saves. See the note on `minPower` below.
 *
 * Applied a second time after the scan, because a silent change in the
 * parameter's behaviour must not put slow chargers back into the file. Unknown
 * power is dropped too: "might be fast" is not good enough to put in front of a
 * driver, and the count is reported so a future run that starts seeing nulls is
 * not silent about it.
 */
const MIN_POWER_KW = 50

/**
 * The second undocumented parameter that makes this script cheap.
 *
 * `minPower=N` is an inclusive `maxPowerInKw >= N` filter, applied server-side
 * *before* the grouping grid runs. Verified by sweep: 50 keeps the 50 kW
 * stations, 51 drops them, and there is no bucketing in between.
 *
 * That ordering is the whole point. Half the network is below 50 kW, so
 * filtering it away upstream means far fewer stations left to collide in any
 * one grid cell, and the clustering that forces a deep blind descent mostly
 * stops happening — the same mechanism that makes `priceGroups` pay.
 *
 * Measured over 48.3..49.3 x 8.7..9.7:
 *   priceGroups only              301 requests, 7.6 s -> 123 stations at >= 50 kW
 *   priceGroups + minPower=50      97 requests, 2.9 s -> 123 stations
 *
 * And over 47.2..48.4 x 10.8..12.2:
 *   priceGroups only              121 requests, 3.7 s -> 77 stations
 *   priceGroups + minPower=50      93 requests, 2.5 s -> 77 stations
 *
 * Identical station sets both times, so this is purely cheaper.
 */

/**
 * Grouping grid. The API divides the requested box into an N x N grid and
 * collapses every cell holding more than one station into a placeholder.
 *
 * Swept 1..200: values above 20 are silently ignored and fall back to the
 * coarse default, so 20 is the finest grid on offer and therefore the fewest
 * placeholders per request.
 */
const GROUPING_DIVISOR = 20

/**
 * Floor for the blind quadtree. Below it, any remaining cluster is probed
 * directly at the centroid the API reports.
 *
 * With the price-group filter the tree converges well before this on real data
 * (0 stuck boxes across a dense test region), so this is a backstop rather than
 * the main mechanism.
 */
const MIN_SPAN_DEG = 0.0005
/** Box size for the first targeted probe around a cluster centroid. */
const PROBE_SPAN_DEG = 0.004
/**
 * Give up probing below this. Measured: a cluster of 58 charge points resolved
 * completely at 0.0008°, so this is an order of magnitude of headroom.
 */
const PROBE_FLOOR_DEG = 0.0002
/**
 * Concurrency. The filtered scan is an order of magnitude smaller than the
 * blind one that earned an HTTP 429, but there is no reason to rush it.
 */
const CONCURRENCY = 4
/** 429s are transient, so be patient rather than failing a 30-minute job. */
const MAX_RETRIES = 8
/** Floor for the pause after a 429, when the server sends no Retry-After. */
const RATE_LIMIT_BACKOFF_MS = 5_000

/** Germany + Austria + northern Italy. */
const DEFAULT_ROOT = { fromLat: 45.7, toLat: 55.1, fromLon: 5.8, toLon: 17.2 }

function parseArgs(argv) {
  const args = { out: 'public/stations.enbw.json', root: DEFAULT_ROOT, resume: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i]
    else if (argv[i] === '--resume') args.resume = true
    else if (argv[i] === '--bbox') {
      const [fromLat, toLat, fromLon, toLon] = argv[++i].split(',').map(Number)
      if ([fromLat, toLat, fromLon, toLon].some((n) => !Number.isFinite(n))) {
        throw new Error('--bbox needs fromLat,toLat,fromLon,toLon')
      }
      args.root = { fromLat, toLat, fromLon, toLon }
    }
  }
  return args
}

async function readKey() {
  if (process.env.ENBW_SUBSCRIPTION_KEY) return process.env.ENBW_SUBSCRIPTION_KEY
  try {
    const text = await readFile('.dev.vars', 'utf8')
    const match = text.match(/^ENBW_SUBSCRIPTION_KEY=(.+)$/m)
    if (match) return match[1].trim()
  } catch {
    /* fall through to the error below */
  }
  throw new Error(
    'ENBW_SUBSCRIPTION_KEY not set. Put it in .dev.vars or the environment. ' +
      'See the README for how to read it off EnBW\'s public map page.',
  )
}

let requestCount = 0
let rateLimitHits = 0

/**
 * Shared cooldown gate.
 *
 * A 429 means the *account* is being throttled, not just one request, so the
 * whole pool has to slow down. Backing off only the failing request leaves the
 * other workers hammering away and the limit never clears.
 */
const throttle = { until: 0 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForThrottle() {
  while (throttle.until > Date.now()) {
    await sleep(Math.min(1_000, throttle.until - Date.now()))
  }
}

async function fetchBox(box, key) {
  const url = new URL(API)
  url.searchParams.set('fromLat', String(box.fromLat))
  url.searchParams.set('toLat', String(box.toLat))
  url.searchParams.set('fromLon', String(box.fromLon))
  url.searchParams.set('toLon', String(box.toLon))
  url.searchParams.set('grouping', 'false')
  url.searchParams.set('groupingDivisor', String(GROUPING_DIVISOR))
  url.searchParams.set('priceGroups', PRICE_GROUP_FILTER)
  url.searchParams.set('minPower', String(MIN_POWER_KW))

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForThrottle()
    try {
      const res = await fetch(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          Origin: REQUIRED_ORIGIN,
          Referer: `${REQUIRED_ORIGIN}/`,
          Accept: 'application/json',
        },
      })
      requestCount++

      if (res.status === 429) {
        rateLimitHits++
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : RATE_LIMIT_BACKOFF_MS * 2 ** Math.min(attempt, 4)
        throttle.until = Math.max(throttle.until, Date.now() + waitMs)
        throw new Error('HTTP 429')
      }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) {
        const hint = res.status === 403 ? ' (the Origin gate or the key may have changed)' : ''
        throw new Error(`HTTP ${res.status}${hint}`)
      }
      const body = await res.json()
      if (!Array.isArray(body)) throw new Error('unexpected payload')
      return body
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err
      await sleep(400 * 2 ** Math.min(attempt, 5))
    }
  }
  return []
}

const quarters = (b) => {
  const midLat = (b.fromLat + b.toLat) / 2
  const midLon = (b.fromLon + b.toLon) / 2
  return [
    { fromLat: b.fromLat, toLat: midLat, fromLon: b.fromLon, toLon: midLon },
    { fromLat: b.fromLat, toLat: midLat, fromLon: midLon, toLon: b.toLon },
    { fromLat: midLat, toLat: b.toLat, fromLon: b.fromLon, toLon: midLon },
    { fromLat: midLat, toLat: b.toLat, fromLon: midLon, toLon: b.toLon },
  ]
}

/** Run `task` over `items` with a fixed worker pool, preserving order. */
async function mapPool(items, limit, task) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        out[i] = await task(items[i])
      }
    }),
  )
  return out
}

const boxAround = (lat, lon, span) => ({
  fromLat: Number((lat - span / 2).toFixed(7)),
  toLat: Number((lat + span / 2).toFixed(7)),
  fromLon: Number((lon - span / 2).toFixed(7)),
  toLon: Number((lon + span / 2).toFixed(7)),
})

const clusterKey = (c, span) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)},${span}`

/**
 * Phase 2: resolve the clusters the quadtree left behind.
 *
 * A cluster placeholder carries its own centroid, so there is no need to guess
 * where to look — query a small box centred on it, and halve the box for any
 * cluster that comes back. This converges in a handful of requests per cluster,
 * where blind quadtree splitting would spend most of its calls on empty space.
 */
async function resolveClusters(initial, stations, key) {
  let pending = initial.map((c) => ({ lat: c.lat, lon: c.lon, span: PROBE_SPAN_DEG }))
  const seen = new Set()
  let probes = 0
  /** Clusters that never resolved, kept whole so the warning can be specific. */
  const abandoned = []

  while (pending.length > 0) {
    const batch = pending.filter((c) => {
      const k = clusterKey(c, c.span)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    if (batch.length === 0) break

    const results = await mapPool(batch, CONCURRENCY, (c) =>
      fetchBox(boxAround(c.lat, c.lon, c.span), key),
    )
    probes += batch.length

    const next = []
    for (let i = 0; i < batch.length; i++) {
      for (const s of results[i]) {
        if (!s.grouped) {
          if (s.stationId != null) stations.set(s.stationId, s)
        } else if (batch[i].span / 2 >= PROBE_FLOOR_DEG) {
          next.push({ lat: s.lat, lon: s.lon, span: batch[i].span / 2 })
        } else {
          abandoned.push(s)
        }
      }
    }
    pending = next
  }

  return { probes, abandoned }
}

/**
 * Checkpoint after every depth level.
 *
 * A full scan is tens of thousands of requests over half an hour. Losing all of
 * it to one unlucky 429 at depth 8 is not acceptable, and the level-by-level
 * structure makes the state trivial to serialise.
 */
async function saveCheckpoint(path, state) {
  await writeFile(path, JSON.stringify(state))
}

async function loadCheckpoint(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function scan(root, key, checkpointPath, resume) {
  const stations = new Map()
  const leftoverClusters = []
  let level = [root]
  let depth = 0

  if (resume) {
    const saved = await loadCheckpoint(checkpointPath)
    if (saved) {
      for (const s of saved.stations) stations.set(s.stationId, s)
      leftoverClusters.push(...(saved.leftoverClusters ?? []))
      level = saved.level
      depth = saved.depth
      console.log(
        `  resuming from depth ${depth}: ${stations.size} stations, ${level.length} boxes pending`,
      )
    }
  }

  while (level.length > 0) {
    const results = await mapPool(level, CONCURRENCY, (box) => fetchBox(box, key))
    const next = []

    for (let i = 0; i < level.length; i++) {
      const box = level[i]
      const clusters = []
      for (const s of results[i]) {
        if (s.grouped) clusters.push(s)
        else if (s.stationId != null) stations.set(s.stationId, s)
      }
      if (clusters.length === 0) continue
      if (box.toLat - box.fromLat <= MIN_SPAN_DEG) {
        leftoverClusters.push(...clusters)
        continue
      }
      next.push(...quarters(box))
    }

    depth++
    process.stdout.write(
      `  depth ${String(depth).padStart(2)}: ${String(level.length).padStart(5)} boxes ` +
        `-> ${String(stations.size).padStart(6)} stations, ${next.length} to split` +
        (rateLimitHits > 0 ? `  (${rateLimitHits} rate-limit pauses)` : '') +
        '\n',
    )
    level = next
    await saveCheckpoint(checkpointPath, {
      depth,
      level,
      leftoverClusters,
      stations: [...stations.values()],
    })
  }

  const before = stations.size
  const { probes, abandoned } = await resolveClusters(leftoverClusters, stations, key)
  process.stdout.write(
    `  probes  : ${String(probes).padStart(5)} targeted ` +
      `-> ${String(stations.size).padStart(6)} stations ` +
      `(+${stations.size - before} from ${leftoverClusters.length} leftover clusters)\n`,
  )

  return { stations: [...stations.values()], depth, abandoned }
}

async function main() {
  const { out, root, resume } = parseArgs(process.argv.slice(2))
  const key = await readKey()
  const checkpointPath = `${out}.checkpoint.json`

  console.log(
    `Scanning ${root.fromLat},${root.toLat} x ${root.fromLon},${root.toLon} ` +
      `(floor ${MIN_SPAN_DEG}°, concurrency ${CONCURRENCY})`,
  )
  const started = Date.now()
  const { stations, abandoned } = await scan(root, key, checkpointPath, resume)
  const seconds = (Date.now() - started) / 1000

  const onTariff = stations.filter((s) => s.priceGroup === ENBW_PRICE_GROUP)
  const enbw = onTariff.filter((s) => (s.maxPowerInKw ?? 0) >= MIN_POWER_KW)

  const tooSlow = onTariff.filter((s) => (s.maxPowerInKw ?? 0) < MIN_POWER_KW)
  const unknownPower = onTariff.filter((s) => s.maxPowerInKw == null)
  console.log(
    `  ${onTariff.length} on the EnBW tariff -> ${enbw.length} at >= ${MIN_POWER_KW} kW ` +
      `(dropped ${tooSlow.length}, of which ${unknownPower.length} had unknown power)`,
  )

  // A silently under-scanned build would ship a permanently incomplete app, so
  // make an incomplete descent loud. Only EnBW-tariff clusters actually matter
  // to this list, so separate them from the noise: a dense non-EnBW site that
  // refuses to resolve costs us nothing.
  const missedEnbw = abandoned.filter((c) => c.priceGroup === ENBW_PRICE_GROUP)
  if (abandoned.length > 0) {
    console.warn(
      `\n  ${abandoned.length} cluster(s) never resolved even at ${PROBE_FLOOR_DEG}° ` +
        `(likely several stations sharing one coordinate).`,
    )
    for (const c of abandoned.slice(0, 10)) {
      console.warn(
        `    ${c.priceGroup === ENBW_PRICE_GROUP ? 'ENBW ' : 'other'} ` +
          `${c.lat.toFixed(5)},${c.lon.toFixed(5)} ` +
          `${c.numberOfChargePoints ?? '?'} points, ${c.operatorCode ?? '?'}`,
      )
    }
  }
  if (missedEnbw.length > 0) {
    console.warn(
      `\n  WARNING: ${missedEnbw.length} of those are on the EnBW tariff and are ` +
        `MISSING from this list.`,
    )
  } else if (abandoned.length > 0) {
    console.warn(`  None are on the EnBW tariff, so this list is unaffected.`)
  }
  if (enbw.length === 0) {
    throw new Error(
      `Scan produced no EnBW stations at >= ${MIN_POWER_KW} kW — refusing to write an empty list.`,
    )
  }

  // The list is now the app's source of truth for station *identity*, so a row
  // without an address is a build defect rather than a runtime inconvenience.
  const missingAddress = enbw.filter((s) => !s.shortAddress?.trim())
  if (missingAddress.length > 0) {
    console.warn(
      `\n  ${missingAddress.length} station(s) came back without an address; ` +
        `those rows will render under their operator name or bare id.`,
    )
  }
  if (missingAddress.length > enbw.length * 0.05) {
    throw new Error(
      `${missingAddress.length} of ${enbw.length} stations have no address (>5%) — ` +
        `refusing to write a list that cannot identify itself.`,
    )
  }

  const payload = {
    // 2: only stations at MIN_POWER_KW or above.
    // 3: carries identity — address, point count, operator — so the app never
    //    depends on a live lookup to know which station a row is.
    version: 3,
    generatedAt: new Date().toISOString(),
    bbox: root,
    count: enbw.length,
    // Packed rather than named: 2,400 rows of {"stationId":...,"lat":...} would
    // triple the file for no gain, since nothing reads these by name — the
    // client unpacks positionally in services/enbw/stations.ts.
    //
    // Occupancy is deliberately absent. It is the one field that changes minute
    // to minute, and a month-old snapshot rendered as authoritative would be
    // worse than the "?" the app shows until the live lookup lands.
    minPowerKw: MIN_POWER_KW,
    fields: ['stationId', 'lat', 'lon', 'maxPowerKw', 'address', 'totalPoints', 'operator'],
    stations: enbw
      .map((s) => [
        s.stationId,
        Math.round(s.lat * 1e5) / 1e5,
        Math.round(s.lon * 1e5) / 1e5,
        s.maxPowerInKw ?? null,
        s.shortAddress?.trim() || null,
        s.numberOfChargePoints ?? 0,
        s.operator?.trim() || null,
      ])
      .sort((a, b) => a[0] - b[0]),
  }

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(payload))

  await rm(checkpointPath, { force: true })

  const bytes = Buffer.byteLength(JSON.stringify(payload))
  console.log(
    `\n  ${requestCount} requests in ${seconds.toFixed(1)}s\n` +
      `  ${stations.length} stations scanned, ${enbw.length} on the EnBW tariff\n` +
      `  wrote ${out} (${(bytes / 1024).toFixed(0)} KB raw, ${(bytes / enbw.length).toFixed(0)} B/station)`,
  )
}

main().catch((err) => {
  console.error(
    `\nBuild failed: ${err.message}\n` +
      `Progress was checkpointed — re-run with --resume to continue.`,
  )
  process.exit(1)
})
