import { describe, expect, it } from 'vitest'
import { buildRouteIndex, haversineM, placeChargersOnRoute, tilesForRoute, type Route } from './corridor'
import { matchesProviderFilter, toCharger, type EnbwStation } from '../providers/enbw'

/**
 * Opt-in integration check against the real EnBW data, via the local Worker.
 *
 *   pnpm dev:worker             # in another shell
 *   SMOKE=1 pnpm vitest run src/routing/liveSmoke.test.ts
 *
 * Skipped by default so `pnpm test` stays hermetic and offline. This exercises
 * the one path unit tests cannot: real station coordinates flowing through tile
 * generation and route projection. It does not touch Mapbox — the route below
 * is a hand-built polyline over the A8, so no token is required.
 */
const enabled = process.env.SMOKE === '1'
const WORKER = process.env.WORKER_URL ?? 'http://127.0.0.1:8787'

/** A8 Stuttgart -> Ulm, sampled off the real motorway alignment. */
const A8: [number, number][] = [
  [9.1829, 48.7758], [9.2280, 48.7420], [9.2800, 48.7130], [9.3400, 48.6950],
  [9.4000, 48.6800], [9.4600, 48.6600], [9.5200, 48.6300], [9.5800, 48.6050],
  [9.6400, 48.5800], [9.7000, 48.5550], [9.7600, 48.5300], [9.8200, 48.4900],
  [9.8800, 48.4500], [9.9300, 48.4200], [9.9800, 48.4000],
]

function buildRoute(coords: [number, number][], kmh = 110): Route {
  const distances: number[] = []
  const durations: number[] = []
  for (let i = 0; i < coords.length - 1; i++) {
    const d = haversineM(
      { lat: coords[i][1], lon: coords[i][0] },
      { lat: coords[i + 1][1], lon: coords[i + 1][0] },
    )
    distances.push(d)
    durations.push(d / ((kmh * 1000) / 3600))
  }
  return {
    coordinates: coords,
    distances,
    durations,
    totalDistanceM: distances.reduce((a, b) => a + b, 0),
    totalDurationS: durations.reduce((a, b) => a + b, 0),
  }
}

describe.skipIf(!enabled)('live corridor smoke test', () => {
  it('finds real EnBW fast chargers along the A8 with sane along-route figures', async () => {
    const route = buildRoute(A8)
    const tiles = tilesForRoute(route, { sampleSpacingM: 8_000, maxTiles: 20 })
    expect(tiles.length).toBeGreaterThan(3)

    const res = await fetch(`${WORKER}/api/chargers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiles }),
    })
    expect(res.ok).toBe(true)
    const { stations } = (await res.json()) as { stations: EnbwStation[] }

    // The Worker must resolve clusters, not pass them through.
    expect(stations.some((s) => s.grouped)).toBe(false)
    expect(stations.length).toBeGreaterThan(20)

    const chargers = stations.map(toCharger)
    const index = buildRouteIndex(route)
    const placed = placeChargersOnRoute(index, chargers, { maxOffsetM: 5_000 })

    expect(placed.length).toBeGreaterThan(0)

    // Ordered by how soon you reach them, and never beyond the route length.
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].alongDistanceM).toBeGreaterThanOrEqual(placed[i - 1].alongDistanceM)
    }
    for (const p of placed) {
      expect(p.alongDistanceM).toBeGreaterThanOrEqual(0)
      expect(p.alongDistanceM).toBeLessThanOrEqual(route.totalDistanceM + 1)
      expect(p.offsetM).toBeLessThanOrEqual(5_000)
      expect(Number.isFinite(p.alongDurationS)).toBe(true)
    }

    // Live availability must be present and internally consistent.
    const withLive = placed.filter((p) => p.charger.availablePoints != null)
    expect(withLive.length).toBeGreaterThan(0)
    for (const p of withLive) {
      expect(p.charger.availablePoints!).toBeGreaterThanOrEqual(0)
      expect(p.charger.availablePoints!).toBeLessThanOrEqual(p.charger.totalPoints)
    }

    const fast = placed.filter(
      (p) => p.charger.operatorCode === 'DEEBW' && (p.charger.maxPowerKw ?? 0) >= 50,
    )
    // eslint-disable-next-line no-console
    console.log(
      `\n  ${placed.length} chargers in corridor, ${fast.length} EnBW fast:\n` +
        fast
          .map(
            (p) =>
              `    ${(p.alongDistanceM / 1000).toFixed(0).padStart(3)} km  ` +
              `${String(p.charger.maxPowerKw).padStart(5)} kW  ` +
              `${p.charger.availablePoints}/${p.charger.totalPoints} free  ` +
              `${(p.offsetM / 1000).toFixed(1)} km off  ${p.charger.name}`,
          )
          .join('\n'),
    )
    expect(fast.length).toBeGreaterThan(0)
  }, 120_000)
})

/** Munich -> Innsbruck -> Brenner -> Bozen -> Dorf Tirol. */
const BRENNER: [number, number][] = [
  [11.5820, 48.1372], [11.4300, 47.8700], [11.4000, 47.5900], [11.3900, 47.4000],
  [11.3900, 47.2600], [11.4600, 47.1200], [11.5100, 47.0020], [11.6000, 46.8900],
  [11.6379, 46.7600], [11.5900, 46.6500], [11.3500, 46.5000], [11.2500, 46.4700],
  [11.1600, 46.6600], [11.1550, 46.7000],
]

describe.skipIf(!enabled)('live cross-border filter check', () => {
  /**
   * Regression guard for a filter that used to be German-only.
   * `operatorCode === 'DEEBW'` returned zero results on this route; EnBW runs
   * its own network abroad as SMATRICS EnBW (ITSMA / ATSMA), all billed at
   * priceGroup ENBW_GROUP.
   */
  it('finds EnBW-operated stations in Austria and Italy', async () => {
    const route = buildRoute(BRENNER, 100)
    const tiles = tilesForRoute(route, { sampleSpacingM: 12_000, maxTiles: 40 })

    const res = await fetch(`${WORKER}/api/chargers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiles }),
    })
    expect(res.ok).toBe(true)
    const { stations } = (await res.json()) as { stations: EnbwStation[] }

    const placed = placeChargersOnRoute(
      buildRouteIndex(route),
      stations.map(toCharger),
      { maxOffsetM: 5_000 },
    )
    const fast = (p: (typeof placed)[number]) => (p.charger.maxPowerKw ?? 0) >= 50
    const enbw = placed.filter((p) => matchesProviderFilter(p.charger, 'enbw') && fast(p))
    const legacy = placed.filter((p) => p.charger.operatorCode === 'DEEBW' && fast(p))

    const abroad = enbw.filter((p) => !(p.charger.address ?? '').trim().endsWith('DE'))
    // eslint-disable-next-line no-console
    console.log(
      `\n  corridor=${placed.length}  DEEBW-only=${legacy.length}  ENBW_GROUP=${enbw.length}\n` +
        abroad
          .map(
            (p) =>
              `    ${(p.alongDistanceM / 1000).toFixed(0).padStart(4)} km  ` +
              `${String(p.charger.maxPowerKw).padStart(4)} kW  ` +
              `${p.charger.availablePoints}/${p.charger.totalPoints} free  ` +
              `${p.charger.operatorCode}  ${p.charger.address}`,
          )
          .join('\n'),
    )

    expect(enbw.length).toBeGreaterThan(legacy.length)
    expect(abroad.length).toBeGreaterThan(0)
  }, 180_000)
})
