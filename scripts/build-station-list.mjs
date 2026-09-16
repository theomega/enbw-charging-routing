#!/usr/bin/env node
/**
 * Build the static EnBW station list.
 *
 * The app no longer discovers chargers at runtime. It ships with a list of
 * every EnBW-tariff station and asks the API only about the occupancy of the
 * handful it displays. This script produces that list.
 *
 * Strategy: ask once. `v1/mapsearch` returns the whole region in a single
 * response — see `MAX_RESULTS`, which is the parameter that makes that true.
 *
 * Then one `/chargestations/{id}` request per surviving station, for the two
 * things the bulk query does not return at all: the location line — the
 * heading the app shows — and the individual charge points, which is where the
 * power of each point comes from. See `fetchDetails`. That phase is the entire
 * cost of the build, and it is one request per station either way.
 *
 *   pnpm build:stations                    # default root: DE + AT + northern IT
 *   pnpm build:stations -- --bbox 48.3,49.3,8.7,9.7   # a small region, for testing
 *   pnpm build:stations -- --out public/stations.enbw.json
 *
 * Requires ENBW_SUBSCRIPTION_KEY, from .dev.vars or the environment.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Detail lookups only — the one endpoint that returns `additionalInfo`. */
const API = 'https://api.emp.emob-enbw.com/emobility-public-api/api/v1/chargestations'
/** The only Origin the upstream accepts; see README. */
const REQUIRED_ORIGIN = 'https://www.enbw.com'

/**
 * The bulk query, and a different service from the detail endpoint above.
 *
 * `emobility-public-api` is what EnBW's public web map talks to, and it offers
 * only the bounding-box query and `/chargestations/{id}`. `emobility-complete`
 * is what the Android app talks to, and it answers the same question in one
 * request instead of tens of thousands.
 *
 * Both speak the same `stationId` namespace, which is the only reason this
 * swap is a local change: verified against the previously shipped list, 2392
 * of its 2404 ids came back identical, the rest being two days of real drift
 * (15 stations added, 12 retired). Addresses, operator names and point counts
 * matched field for field.
 *
 * Taken from the EnBW mobility+ Android app (8.18.2), along with the two keys
 * below. Both are baked into the APK and neither is tied to an account — no
 * login or bearer token is involved, and the request works unauthenticated.
 */
const MAPSEARCH = 'https://api.emp.emob-enbw.com/emobility-complete/api/v1/mapsearch'
const MAPSEARCH_SUBSCRIPTION_KEY =
  process.env.ENBW_MAPSEARCH_SUBSCRIPTION_KEY ?? 'c7097f4712dd4c20aae95ff6ad95d171'
const MAPSEARCH_API_KEY = process.env.ENBW_MAPSEARCH_API_KEY ?? 'k385hjj5456rlqsnhjkhsh4dih'

/**
 * The parameter that removes the search.
 *
 * This script used to run an adaptive quadtree over the map, because a
 * bounding box that holds too many stations comes back as cluster
 * placeholders instead of stations — so the box had to be split, and split
 * again, tens of thousands of times.
 *
 * The splitting was never necessary. Clustering is not a function of how
 * large the box is; it is a function of how many rows the answer would have.
 * `maxResults` caps that number explicitly, and a capped query does not
 * cluster at all. The whole of DE + AT + northern Italy then answers in one
 * request:
 *
 *   quadtree (priceGroups + minPower)   ~30 min, tens of thousands of requests
 *   maxResults                          1.0 s, 1 request, 1.9 MB -> 2407 stations
 *
 * Set far above the real count, because the cap does not report itself. Ask
 * for 2000 when 2407 exist and the response is 2000 stations, no clusters, no
 * error, no flag — a silently half-built list. `assertNotTruncated` is what
 * stands between that and a shipped file.
 */
const MAX_RESULTS = 20_000

/**
 * Minimum charging power, in kW, for a station to be worth shipping.
 *
 * This app is for finding a charge on a long drive, where an 11 or 22 kW AC
 * post is not a stop anyone would make — it is an overnight charger. Filtering
 * here rather than in the UI is the point: half the EnBW network is below this
 * line, so dropping it halves the file the phone downloads and halves the
 * geometry the corridor has to run.
 *
 * Sent as `minPowerInKw` in the filter body, which the server applies. Applied
 * a second time after the query, because a silent change in the parameter's
 * behaviour must not put slow chargers back into the file. Unknown power is
 * dropped too: "might be fast" is not good enough to put in front of a driver,
 * and the count is reported so a future run that starts seeing nulls is not
 * silent about it.
 */
const MIN_POWER_KW = 50

/**
 * Concurrency, for the detail lookups. Nothing to rush: one 429 mid-run costs
 * more than the parallelism saves.
 */
const CONCURRENCY = 4
/** 429s are transient, so be patient rather than failing the job. */
const MAX_RETRIES = 8
/** Floor for the pause after a 429, when the server sends no Retry-After. */
const RATE_LIMIT_BACKOFF_MS = 5_000

/**
 * The area to ask about: Germany, Austria, Czechia and northern Italy, with
 * room to spare on every edge.
 *
 * The margin is the point. This box used to be 45.7–55.1 x 5.8–17.2, described
 * as "Germany + Austria + northern Italy", and it silently cut 31 stations off
 * the list: 30 in eastern Czechia — Ostrava, Olomouc, Zlín, Havířov — which sit
 * out to 18.67°E, and the 400 kW, 16-point hub at Trezzo sull'Adda, which sits
 * at 45.60°N, just below the old southern edge. Czechia was never a stretch
 * goal that got clipped; 151 Czech stations were already in the shipped list.
 * The box simply stopped partway through the country.
 *
 * Measured against a query for the whole planet, which is the only way to know
 * what "outside" even contains: 2,438 stations exist on this tariff at
 * >= 50 kW, in DE (1,952), AT (301), CZ (181) and IT (4), and nowhere else.
 * They span 45.6035–54.8756°N and 6.0129–18.6677°E. The bounds below clear
 * that on all four sides by 0.6°–1.0°, roughly 60–110 km.
 *
 * Widening costs one thing only: a detail lookup for each station it newly
 * finds. The scan itself is a single request whatever the box is, so there is
 * no reason to run this close to the edge of the network.
 */
const DEFAULT_ROOT = { fromLat: 45.0, toLat: 55.6, fromLon: 5.0, toLon: 19.5 }

function parseArgs(argv) {
  const args = { out: 'public/stations.enbw.json', root: DEFAULT_ROOT }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i]
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
      "See the README for how to read it off EnBW's public map page.",
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

/**
 * Statuses worth trying again. A 429 is the account being throttled and a 5xx
 * is upstream having a moment; anything else in the 4xx range is an answer —
 * retrying a 404 eight times with backoff just makes the run slower.
 */
const isTransient = (status) => status === 429 || status >= 500

/**
 * One request, with the throttle gate and the retry ladder around it.
 *
 * Shared by both phases: the bulk query and the detail lookups go to different
 * services, but a run that is being throttled should slow down as a whole.
 */
async function requestJson(url, { headers, body } = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForThrottle()
    try {
      const res = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      requestCount++

      if (res.status === 429) {
        rateLimitHits++
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : RATE_LIMIT_BACKOFF_MS * 2 ** Math.min(attempt, 4)
        throttle.until = Math.max(throttle.until, Date.now() + waitMs)
        throw new Error('HTTP 429')
      }
      if (!res.ok && !isTransient(res.status)) {
        const hint =
          res.status === 403 || res.status === 401
            ? ' (a key or the Origin gate may have changed)'
            : ''
        // Permanent: reported by the caller, never retried.
        throw Object.assign(new Error(`HTTP ${res.status}${hint}`), { permanent: true })
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      return await res.json()
    } catch (err) {
      if (err.permanent || attempt === MAX_RETRIES) throw err
      await sleep(400 * 2 ** Math.min(attempt, 5))
    }
  }
  return null
}

/**
 * The filter body.
 *
 * `includeOtherOperators: false` is the server-side stand-in for the old
 * `priceGroups=ENBW_GROUP` query parameter, and it selects the same set:
 * every one of the 2407 stations it returned came back
 * `shouldBeTreatedLikeEnBW`, across the same seven operator codes the old
 * filter produced, and all 185 of the CZPRE and DEEDH rows — the two codes
 * this file used not to name — were already in the previously shipped list.
 *
 * The remaining fields are sent because the endpoint expects the whole filter
 * object, not because this build wants to narrow on them.
 */
const filterBody = () => ({
  plugTypes: null,
  minPowerInKw: MIN_POWER_KW,
  maxPowerInKw: null,
  currentlyAvailable: null,
  alwaysOpen: null,
  operators: null,
  authenticationMethods: null,
  presetSelected: 0,
  presetPlugTypes: {},
  freeCharging: null,
  handicappedAccessible: null,
  minimumNumberOfChargingPoints: 0,
  priceLimit: null,
  includeOtherOperators: false,
  pointOfInterestCategories: null,
})

/**
 * Phase 1: the whole region, in one request.
 *
 * `grouping=false` is sent for good measure, but `maxResults` is what actually
 * suppresses the cluster placeholders — the unfiltered call returns 15
 * clusters and zero stations for this same box.
 */
async function fetchAll(box) {
  const url = new URL(MAPSEARCH)
  url.searchParams.set('fromLat', String(box.fromLat))
  url.searchParams.set('toLat', String(box.toLat))
  url.searchParams.set('fromLon', String(box.fromLon))
  url.searchParams.set('toLon', String(box.toLon))
  url.searchParams.set('grouping', 'false')
  url.searchParams.set('useFilter', 'true')
  url.searchParams.set('maxResults', String(MAX_RESULTS))

  const body = await requestJson(url, {
    headers: {
      'Ocp-Apim-Subscription-Key': MAPSEARCH_SUBSCRIPTION_KEY,
      apiKey: MAPSEARCH_API_KEY,
    },
    body: filterBody(),
  })
  if (!body || !Array.isArray(body.pins)) throw new Error('unexpected payload')
  return body
}

/**
 * Refuse to build on an answer that may have been cut short.
 *
 * Two ways this query can under-report, both silent. `maxResults` truncates to
 * exactly the cap with no flag of any kind, and a query that ignored the cap
 * falls back to returning clusters — placeholders standing in for stations
 * this build would otherwise simply never see.
 */
function assertNotTruncated(body) {
  const clusters = body.clusters?.length ?? 0
  if (clusters > 0) {
    throw new Error(
      `The query came back with ${clusters} cluster placeholder(s), which means ` +
        `maxResults was ignored and an unknown number of stations are hidden ` +
        `behind them. Refusing to write a partial list.`,
    )
  }
  if (body.pins.length >= MAX_RESULTS) {
    throw new Error(
      `Got exactly maxResults (${MAX_RESULTS}) stations, so the answer was almost ` +
        `certainly truncated. Raise MAX_RESULTS and re-run.`,
    )
  }
}

/**
 * One pin, flattened to the shape the rest of this script expects.
 *
 * The bulk query nests station identity under `locationPreview` and keeps the
 * occupancy counts at the top level; everything below is the same data the
 * bounding-box query used to return under different names.
 */
function unpackPin(pin) {
  const p = pin.locationPreview ?? {}
  return {
    stationId: p.stationId,
    lat: p.location?.latitude,
    lon: p.location?.longitude,
    shortAddress: p.address ?? null,
    operator: p.operatorName ?? null,
    maxPowerInKw: p.maxPowerInKw ?? null,
    // Not written to the file, and not a total either: `allChargePointCount`
    // counts only the points matching the `minPowerInKw` this query was made
    // with — measured against both endpoints, station 89607 answers 16 at
    // >= 50 kW and 18 unfiltered. It used to be shipped as `totalPoints`, where
    // the live record then overwrote it with the real total and a badge went
    // from "4" to "8" without the station changing. The station's size now
    // comes from `pointPowers`, which sums to it. Kept here only for the
    // build's own reporting.
    matchingChargePoints: pin.allChargePointCount ?? 0,
    // The bulk query has no `priceGroup`; this is the field that replaces it.
    onEnbwTariff: pin.shouldBeTreatedLikeEnBW === true,
  }
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

/**
 * The detail record for one station.
 *
 * The only endpoint that returns `additionalInfo`, which is why phase 2 exists
 * at all. Also the only one that can 404: the bulk query occasionally reports
 * an id the detail endpoint no longer serves.
 */
const fetchStation = (stationId, key) =>
  requestJson(new URL(`${API}/${stationId}`), {
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      Origin: REQUIRED_ORIGIN,
      Referer: `${REQUIRED_ORIGIN}/`,
    },
  })

/**
 * Location text that is not a location.
 *
 * Some stations carry a parking notice where the site name belongs — "Bitte
 * beachten Sie die allgemeine Parkplatzverordnung am Standort bezüglich
 * Höchstparkdauer…" — which is prose about the car park rather than a name to
 * look for. A row headed with it says nothing about where the station is, so
 * those fall back to the address like a station that reports no location at all.
 *
 * Matched case-insensitively against the whole field, not only the line that
 * becomes the heading. Measured over 250 stations, every occurrence *was* the
 * first line, so there is no good name to be saved by being narrower.
 */
const LOCATION_BLACKLIST = ['Parkplatzverordnung', 'kostenlos', 'Öffnungszeiten']

const isNotice = (text) =>
  !!text && LOCATION_BLACKLIST.some((word) => text.toLowerCase().includes(word.toLowerCase()))

/**
 * The heading a station is displayed under.
 *
 * EnBW packs several lines into `additionalInfo`: the name of the site it
 * stands at, then access and parking prose. The first line is the name — "ENI
 * Schottwien", "REWE Wirges, Samoborstraße 5" — and the rest belongs to a
 * paragraph nobody reads at 130 km/h.
 */
const firstLine = (text) => text?.split(/\r?\n/)[0]?.trim() || null

/**
 * One station's charge points, counted by power.
 *
 * The station's own `maxPowerInKw` is the fastest thing it has, which says
 * nothing about the rest: a motorway hub is listed at 300 kW and keeps 22 kW AC
 * posts beside the fast stalls. Without this the app can filter which stations
 * it lists but not how many points it credits each one with, so a station shown
 * because it can do 300 kW reports every AC post in its point count.
 *
 * A point with several connectors is one stall with alternative cables, so it
 * delivers the highest of them rather than their sum — the same rule the Worker
 * applies to the live record; see `trimChargePoints` in worker/index.ts.
 *
 * Statuses are deliberately dropped. They are the half of the record that
 * changes minute to minute, which is what the runtime lookup is for; a month-old
 * snapshot of them would be worse than the "?" the app shows until it lands.
 */
function pointPowers(chargePoints) {
  if (!Array.isArray(chargePoints) || chargePoints.length === 0) return null
  const counts = new Map()
  for (const point of chargePoints) {
    const powers = (point.connectors ?? []).map((c) => c.maxPowerInKw).filter((kw) => kw != null)
    const power = powers.length > 0 ? Math.max(...powers) : null
    counts.set(power, (counts.get(power) ?? 0) + 1)
  }
  // Fastest first, unknown power last — the order the app displays groups in,
  // so the packed row reads the way the panel does.
  return [...counts].sort(([a], [b]) => (a == null ? 1 : b == null ? -1 : b - a))
}

/**
 * Phase 2: fill in what only the detail endpoint knows, one request per station.
 *
 * This is the whole cost of the build, and it buys the two things the bulk query
 * cannot get. `additionalInfo` is what every row in the app is headed with,
 * because the name on the sign you are looking for is more use than the street
 * it stands on — fetching it here rather than on the phone is what keeps that
 * heading from changing under the driver a second after the list appears. And
 * `chargePoints` is where each point's own power comes from, which is what the
 * app's point count is filtered by.
 *
 * Both come out of the same response, so the second one is free.
 */
async function fetchDetails(stations, key) {
  let done = 0
  let gone = 0
  let notices = 0
  let unnamed = 0
  let unpointed = 0
  const details = await mapPool(stations, CONCURRENCY, async (s) => {
    let line = null
    let points = null
    try {
      const station = await fetchStation(s.stationId, key)
      points = pointPowers(station?.chargePoints)
      if (!points) unpointed++
      const info = station?.additionalInfo
      if (isNotice(info)) {
        notices++
      } else {
        line = firstLine(info)
        if (!line) unnamed++
      }
    } catch {
      // A 404 here is an id the bulk query reported and the detail endpoint no
      // longer serves. The station keeps its street label and its station-level
      // point count; one missing heading is not worth failing the build over.
      gone++
    }
    done++
    if (done % 200 === 0 || done === stations.length) {
      process.stdout.write(
        `  details: ${String(done).padStart(5)}/${stations.length}` +
          (gone > 0 ? `  (${gone} unanswered)` : '') +
          (rateLimitHits > 0 ? `  (${rateLimitHits} rate-limit pauses)` : '') +
          '\n',
      )
    }
    return { line, points }
  })
  return { details, gone, notices, unnamed, unpointed }
}

async function main() {
  const { out, root } = parseArgs(process.argv.slice(2))
  const key = await readKey()

  console.log(`Querying ${root.fromLat},${root.toLat} x ${root.fromLon},${root.toLon}`)
  const started = Date.now()
  const body = await fetchAll(root)
  assertNotTruncated(body)
  const stations = body.pins.map(unpackPin)
  const seconds = (Date.now() - started) / 1000
  console.log(`  ${stations.length} stations in one request, ${seconds.toFixed(1)}s`)

  const onTariff = stations.filter((s) => s.onEnbwTariff)
  const enbw = onTariff.filter((s) => (s.maxPowerInKw ?? 0) >= MIN_POWER_KW)

  const tooSlow = onTariff.filter((s) => (s.maxPowerInKw ?? 0) < MIN_POWER_KW)
  const unknownPower = onTariff.filter((s) => s.maxPowerInKw == null)
  console.log(
    `  ${onTariff.length} on the EnBW tariff -> ${enbw.length} at >= ${MIN_POWER_KW} kW ` +
      `(dropped ${tooSlow.length}, of which ${unknownPower.length} had unknown power)`,
  )

  // The server-side filter should already have excluded these, so a non-zero
  // count means `includeOtherOperators` has changed meaning and the list may
  // now be a different set of stations than the app's tariff covers.
  const offTariff = stations.length - onTariff.length
  if (offTariff > 0) {
    console.warn(
      `\n  ${offTariff} station(s) came back without shouldBeTreatedLikeEnBW and were ` +
        `dropped. The server-side filter should have excluded them upstream.`,
    )
  }

  if (enbw.length === 0) {
    throw new Error(
      `Query produced no EnBW stations at >= ${MIN_POWER_KW} kW — refusing to write an empty list.`,
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

  // Phase 2 runs on the filtered set, so the requests are spent only on
  // stations that will actually be in the file.
  const { details, gone, notices, unnamed, unpointed } = await fetchDetails(enbw, key)
  const named = details.filter((d) => d.line).length
  console.log(
    `  ${named} of ${enbw.length} stations have a location line; ` +
      `${enbw.length - named} fall back to the address ` +
      `(${notices} a parking notice, ${unnamed} not reported, ${gone} unanswered)`,
  )

  // The reason this build fetches point powers at all, as a number: every point
  // below the floor is one the app used to count towards a station's displayed
  // total. A run that suddenly reports none of them has lost the field.
  const counted = details.flatMap((d) => d.points ?? [])
  const points = counted.reduce((n, [, count]) => n + count, 0)
  const slow = counted
    .filter(([kw]) => kw != null && kw < MIN_POWER_KW)
    .reduce((n, [, count]) => n + count, 0)
  const matching = enbw.reduce((n, s) => n + (s.matchingChargePoints ?? 0), 0)
  console.log(
    `  ${enbw.length - unpointed} of ${enbw.length} stations report their points ` +
      `(${points} points, of which ${slow} are below ${MIN_POWER_KW} kW; ` +
      `the scan counted ${matching} at >= ${MIN_POWER_KW} kW)`,
  )

  // The same rule the address has, for the same reason: the point counts are
  // now the only thing a row can state its size from, so a run that stops
  // getting them is a build defect and not something a driver finds out on the
  // motorway. Warned about at any level, refused above 5%.
  if (unpointed > 0) {
    console.warn(
      `\n  ${unpointed} station(s) came back without charge points; those rows ` +
        `will show "?" until a live lookup answers for them.`,
    )
  }
  if (unpointed > enbw.length * 0.05) {
    throw new Error(
      `${unpointed} of ${enbw.length} stations report no charge points (>5%) — ` +
        `refusing to write a list whose rows cannot say how big they are.`,
    )
  }

  const payload = {
    // 2: only stations at MIN_POWER_KW or above.
    // 3: carries identity — address, point count, operator — so the app never
    //    depends on a live lookup to know which station a row is.
    // 4: carries the location line too, which is the heading the app shows. It
    //    costs one detail request per station to build and is the reason a row
    //    can name itself before any network call.
    // 5: carries each station's points by power, out of the same detail request
    //    as the location line, and drops `totalPoints`. It is what the app
    //    filters the displayed point count by, so a 300 kW hub stops counting
    //    its 22 kW AC posts — and the dropped column was never a total anyway;
    //    see `matchingChargePoints` in unpackPin.
    //
    // It stayed 4 across the move to the bulk query, because that changed no
    // field and no meaning. This one replaces a column, so a version 4 file is
    // not readable as this one — deliberately, while the app is in testing and
    // the only client is rebuilt with the file.
    version: 5,
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
    fields: [
      'stationId',
      'lat',
      'lon',
      'maxPowerKw',
      'address',
      'operator',
      'location',
      // [maxPowerKw, count] pairs, fastest first, summing to the station's
      // size. Null where the detail endpoint did not answer — the app has no
      // count for those rows at all and says so, rather than showing one that
      // ignores the driver's setting.
      'points',
    ],
    // Sorted by id, so the row order is the same on every rebuild and a diff
    // shows what actually changed rather than a reshuffle.
    stations: enbw
      .map((s, i) => [
        s.stationId,
        Math.round(s.lat * 1e5) / 1e5,
        Math.round(s.lon * 1e5) / 1e5,
        s.maxPowerInKw ?? null,
        s.shortAddress?.trim() || null,
        s.operator?.trim() || null,
        details[i].line,
        details[i].points,
      ])
      .sort((a, b) => a[0] - b[0]),
  }

  // Indented rather than minified: this file is committed, so a rebuild has to
  // be reviewable in a diff rather than landing as one changed line 300 KB
  // long. Measured cost at 2,438 stations: 294 KB -> 445 KB on disk, but only
  // 97 KB -> 104 KB gzipped, which is what the phone actually downloads.
  //
  // Row order is the other half of this; see the sort above.
  const text = JSON.stringify(payload, null, 2)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, text)

  const bytes = Buffer.byteLength(text)
  console.log(
    `\n  ${requestCount} requests in ${((Date.now() - started) / 1000).toFixed(1)}s\n` +
      `  ${stations.length} stations queried, ${enbw.length} on the EnBW tariff\n` +
      `  wrote ${out} (${(bytes / 1024).toFixed(0)} KB raw, ${(bytes / enbw.length).toFixed(0)} B/station)`,
  )
}

main().catch((err) => {
  console.error(`\nBuild failed: ${err.message}`)
  process.exit(1)
})
