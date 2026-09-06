import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MAX_OFFSET_M, buildCorridor, placeChargersOnRoute } from '../core/corridor'
import { priceDetours, routePenaltySeconds } from '../core/detour'
import type { Charger, ChargerOnRoute, LatLon } from '../core/types'
import { fetchAvailability, type OccupancyRecord } from '../services/enbw/availability'
import { parseStationList, type StationList } from '../services/enbw/stations'
import { fetchRoutes, type RouteOption } from '../services/mapbox/directions'
import { fetchMatrix } from '../services/mapbox/matrix'

/**
 * Opt-in integration check: real Mapbox routes, the shipped station list, real
 * EnBW occupancy through the local Worker. Nothing here is a fixture, which is
 * the point — it catches what unit tests cannot, like Mapbox quietly changing a
 * response shape.
 *
 *   pnpm build:stations
 *   pnpm dev:worker
 *   SMOKE=1 pnpm vitest run src/search/liveSmoke.test.ts
 */

const enabled = process.env.SMOKE === '1'
const WORKER = process.env.WORKER_URL ?? 'http://127.0.0.1:8787'
const STATION_LIST = process.env.STATION_LIST ?? 'public/stations.enbw.json'

const MAX_OFFSET_M = DEFAULT_MAX_OFFSET_M

const STUTTGART: LatLon = { lat: 48.7758, lon: 9.1829 }
const ULM: LatLon = { lat: 48.4011, lon: 9.9876 }
const MUNICH: LatLon = { lat: 48.1372, lon: 11.5756 }
const BERLIN: LatLon = { lat: 52.52, lon: 13.405 }
/** Segenbühelweg 15, 39019 Dorf Tirol, Italy. */
const DORF_TIROL: LatLon = { lat: 46.7, lon: 11.155 }

const loadList = async (): Promise<StationList> =>
  parseStationList(JSON.parse(await readFile(STATION_LIST, 'utf8')))

const placeAlong = (route: RouteOption, chargers: Charger[]): Promise<ChargerOnRoute[]> =>
  placeChargersOnRoute(buildCorridor(route.route, MAX_OFFSET_M), chargers)

/** Ask the Worker for occupancy exactly as the browser would. */
const viaWorker = async (stationIds: number[]): Promise<OccupancyRecord[]> => {
  const res = await fetch(`${WORKER}/api/chargers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stationIds }),
  })
  if (!res.ok) throw new Error(`Worker returned ${res.status}: ${await res.text()}`)
  return ((await res.json()) as { stations: OccupancyRecord[] }).stations
}

describe.skipIf(!enabled)('live: real Mapbox route + shipped list + live occupancy', () => {
  it('places the station list along a real Stuttgart -> Ulm route', async () => {
    const [list, routes] = await Promise.all([loadList(), fetchRoutes(STUTTGART, ULM)])
    const route = routes[0]

    const started = performance.now()
    const placed = await placeAlong(route, list.chargers)
    const elapsed = performance.now() - started

    // eslint-disable-next-line no-console
    console.log(
      `\n  list=${list.meta.count} stations (generated ${list.meta.generatedAt})\n` +
        `  route: ${(route.route.totalDistanceM / 1000).toFixed(0)} km via ${route.summary}, ` +
        `${route.route.coordinates.length} vertices\n` +
        `  ${list.chargers.length} measured -> ${placed.length} in corridor ` +
        `in ${elapsed.toFixed(0)} ms`,
    )

    // The route came from Mapbox, so this also checks the annotation arrays
    // line up with the geometry — a silent shape change would break it.
    expect(route.route.distances.length).toBe(route.route.coordinates.length - 1)
    expect(placed.length).toBeGreaterThan(0)

    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].alongDistanceM).toBeGreaterThanOrEqual(placed[i - 1].alongDistanceM)
    }
    for (const p of placed) {
      expect(p.offsetM).toBeLessThanOrEqual(MAX_OFFSET_M)
      expect(p.alongDistanceM).toBeLessThanOrEqual(route.route.totalDistanceM + 1)
    }
  }, 120_000)

  it('describes every row from the shipped list, before any live call', async () => {
    const [list, routes] = await Promise.all([loadList(), fetchRoutes(MUNICH, DORF_TIROL)])
    const route = routes[0]

    const candidates = (await placeAlong(route, list.chargers)).slice(0, 20)
    expect(candidates.length).toBeGreaterThan(0)

    // The headline claim of carrying identity offline: a complete row with no
    // network call at all beyond the list itself.
    const described = candidates.filter((c) => c.charger.address && c.charger.totalPoints > 0)
    // eslint-disable-next-line no-console
    console.log(
      `\n  ${described.length}/${candidates.length} rows fully described from the list alone\n` +
        candidates
          .slice(0, 5)
          .map((c) => `    ${c.charger.name} — ${c.charger.address ?? '(no address)'}`)
          .join('\n'),
    )
    expect(described.length / candidates.length).toBeGreaterThanOrEqual(0.95)
    for (const c of candidates) expect(c.charger.availablePoints).toBeNull()

    const { live, missing } = await fetchAvailability(
      candidates.map((c) => c.charger),
      { fetcher: viaWorker },
    )

    // eslint-disable-next-line no-console
    console.log(
      `\n  Munich -> Dorf Tirol via ${route.summary}: ` +
        `${(route.route.totalDistanceM / 1000).toFixed(0)} km\n` +
        `  ${live.size}/${candidates.length} resolved live, ${missing.length} stale id(s)\n` +
        candidates
          .slice(0, 8)
          .map((c) => {
            const o = live.get(c.charger.id)
            const free = o
              ? `${o.availablePoints}/${o.totalPoints ?? c.charger.totalPoints}`
              : '?/?'
            return (
              `    ${(c.alongDistanceM / 1000).toFixed(0).padStart(4)} km  ` +
              `${String(c.charger.maxPowerKw).padStart(4)} kW  ${free.padStart(6)} free  ` +
              `${c.charger.address}`
            )
          })
          .join('\n'),
    )

    expect(live.size).toBeGreaterThan(0)
    for (const o of live.values()) {
      expect(o.availablePoints).toBeGreaterThanOrEqual(0)
      expect(o.availablePoints).toBeLessThanOrEqual(o.totalPoints ?? Infinity)
    }
    // Stale ids are expected — EnBW re-issues them — but a large share means
    // the list needs rebuilding.
    expect(missing.length).toBeLessThan(candidates.length / 2)
  }, 180_000)

  it('offers real alternatives with distinct summaries, and prices detour against the chosen one', async () => {
    const routes = await fetchRoutes(BERLIN, DORF_TIROL)

    // eslint-disable-next-line no-console
    console.log(
      `\n  Berlin -> Dorf Tirol: ${routes.length} route(s)\n` +
        routes
          .map(
            (r, i) =>
              `    [${i}] ${(r.route.totalDistanceM / 1000).toFixed(0).padStart(4)} km  ` +
              `${(r.route.totalDurationS / 3600).toFixed(2)} h  via ${r.summary}`,
          )
          .join('\n'),
    )

    expect(routes.length).toBeGreaterThan(1)
    // Alternatives that read identically would be useless to choose between.
    expect(new Set(routes.map((r) => r.summary)).size).toBeGreaterThan(1)
    for (const r of routes) {
      expect(r.summary.length).toBeGreaterThan(0)
      // The map draws these coordinates directly, with no simplification and no
      // budget to fit, so an unusable geometry would surface as a blank map.
      expect(r.route.coordinates.length).toBeGreaterThan(1)
    }

    // Detour, priced by the real Matrix API against the slower alternative.
    const list = await loadList()
    const slower = routes[routes.length - 1]
    const penaltyS = routePenaltySeconds(
      slower.route.totalDurationS,
      routes[0].route.totalDurationS,
    )
    const candidates = (await placeAlong(slower, list.chargers))
      .filter((c) => (c.charger.maxPowerKw ?? 0) >= 100)
      .slice(0, 8)
    expect(candidates.length).toBeGreaterThan(0)

    const priced = await priceDetours(BERLIN, DORF_TIROL, candidates, {
      matrix: fetchMatrix,
      penaltyS,
    })
    const known = priced.filter((c) => c.detourS != null)

    // eslint-disable-next-line no-console
    console.log(
      `\n  detour on the slower alternative (penalty ${Math.round(penaltyS / 60)} min):\n` +
        known
          .slice(0, 6)
          .map(
            (c) =>
              `    ${(c.alongDistanceM / 1000).toFixed(0).padStart(4)} km  ` +
              `+${Math.round((c.detourS ?? 0) / 60)} min`,
          )
          .join('\n'),
    )

    expect(known.length).toBeGreaterThan(0)
    for (const c of known) {
      expect(c.detourS).toBeGreaterThanOrEqual(0)
      // A charger on the route should not read as an hour off it. Anything
      // larger means the re-baselining or t_direct is wrong.
      expect(c.detourS!).toBeLessThan(45 * 60)
    }
  }, 180_000)

  it('includes EnBW stations abroad, fully described by the shipped list', async () => {
    const list = await loadList()
    // SMATRICS EnBW Italia, Vahrn — the station that exposed the German-only
    // operatorCode bug. Its id may have been re-issued since; the address is
    // what must be there.
    const vahrn = list.chargers.find((c) => c.address?.includes('Vahrn'))
    expect(vahrn, 'an EnBW station in Vahrn must be in the shipped list').toBeDefined()
    expect(vahrn!.address).toBeTruthy()
    expect(vahrn!.totalPoints).toBeGreaterThan(0)
    expect(vahrn!.availablePoints).toBeNull()

    const { live } = await fetchAvailability([vahrn!], { fetcher: viaWorker })
    const o = live.get(vahrn!.id)
    // A 404 here is legitimate (re-issued id) and must not fail the run — the
    // row is still complete without it.
    if (o) expect(o.availablePoints).toBeLessThanOrEqual(o.totalPoints ?? Infinity)
  }, 60_000)
})
