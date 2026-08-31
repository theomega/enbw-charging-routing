import type { Charger, ChargerProvider, Tile } from './types'

/**
 * EnBW's undocumented public endpoint (the one behind their own web map).
 *
 * Only the fields we actually consume are typed. Verified against
 * api.emp.emob-enbw.com/emobility-public-api/api/v1/chargestations while
 * planning; see the plan file for the raw sample response.
 */
export interface EnbwStation {
  /** True for cluster placeholders, which carry no per-station data. */
  grouped: boolean
  stationId: number
  lat: number
  lon: number
  shortAddress: string | null
  operator: string | null
  operatorCode: string | null
  priceGroup: string | null
  numberOfChargePoints: number | null
  availableChargePoints: number | null
  unknownStateChargePoints: number | null
  maxPowerInKw: number | null
  plugTypes: string[] | null
  plugTypeNames: string[] | null
  authenticationMethods: string[] | null
  alwaysOpen: boolean | null
}

export const ENBW_CARD_AUTH = 'MOBILITY_PLUS_CHARGE_CARD'
export const ENBW_PRICE_GROUP = 'ENBW_GROUP'

/** Map one EnBW wire record onto the provider-neutral model. */
export function toCharger(s: EnbwStation): Charger {
  const address = s.shortAddress?.trim() || null
  return {
    id: `enbw:${s.stationId}`,
    providerId: 'enbw',
    // EnBW has no station name field; the street part of the address is the
    // most recognisable label, with the operator as a fallback.
    name: address?.split(',')[0]?.trim() || s.operator || `Station ${s.stationId}`,
    address,
    lat: s.lat,
    lon: s.lon,
    totalPoints: s.numberOfChargePoints ?? 0,
    availablePoints: s.availableChargePoints ?? null,
    unknownPoints: s.unknownStateChargePoints ?? 0,
    maxPowerKw: s.maxPowerInKw ?? null,
    plugTypes: s.plugTypeNames ?? s.plugTypes ?? [],
    operator: s.operator ?? null,
    operatorCode: s.operatorCode ?? null,
    priceGroup: s.priceGroup ?? null,
    authMethods: s.authenticationMethods ?? [],
    alwaysOpen: s.alwaysOpen ?? false,
  }
}

/**
 * Which stations count as "mine".
 *
 * Ordered from narrowest to widest — `widenFilter` walks this list when the
 * result set is too thin to be useful.
 */
export const PROVIDER_FILTERS = ['enbw', 'card-usable', 'all'] as const
export type ProviderFilter = (typeof PROVIDER_FILTERS)[number]

export const PROVIDER_FILTER_LABELS: Record<ProviderFilter, string> = {
  enbw: 'EnBW network',
  'card-usable': 'Works with my EnBW card',
  all: 'All stations',
}

export function matchesProviderFilter(c: Charger, filter: ProviderFilter): boolean {
  switch (filter) {
    case 'enbw':
      /**
       * `priceGroup`, NOT `operatorCode`.
       *
       * An earlier version tested `operatorCode === 'DEEBW'`, which is EnBW's
       * *German* operator code and silently hid EnBW's own network abroad:
       * SMATRICS EnBW Italia (`ITSMA`), SMATRICS Austria (`ATSMA`), and even
       * German subsidiaries like `DEODR`/`DESMA`. Measured over 801 stations in
       * five countries, `DEEBW` matched 74 and `ENBW_GROUP` matched 79 — every
       * DEEBW station carries ENBW_GROUP, so this is the same set plus the ones
       * the operator code was wrongly dropping (including a 400 kW site in
       * South Tyrol).
       */
      return c.priceGroup === ENBW_PRICE_GROUP
    case 'card-usable':
      return c.authMethods.includes(ENBW_CARD_AUTH)
    case 'all':
      return true
  }
}

/** The next broader filter, or null if already at the widest. */
export function widenFilter(filter: ProviderFilter): ProviderFilter | null {
  const i = PROVIDER_FILTERS.indexOf(filter)
  return i >= 0 && i < PROVIDER_FILTERS.length - 1 ? PROVIDER_FILTERS[i + 1] : null
}

/**
 * Provider bound to our Worker. The browser cannot call EnBW directly: the
 * endpoint 403s any Origin other than https://www.enbw.com, and JS cannot set
 * Origin. The Worker does the tile fan-out and returns ungrouped, deduped rows.
 */
export const enbwProvider: ChargerProvider = {
  id: 'enbw',
  label: 'EnBW mobility+',
  async fetchInTiles(tiles: Tile[], signal?: AbortSignal): Promise<Charger[]> {
    if (tiles.length === 0) return []
    const res = await fetch('/api/chargers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tiles }),
      signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Charger lookup failed (${res.status}): ${detail.slice(0, 200)}`)
    }
    const body = (await res.json()) as { stations: EnbwStation[] }
    return body.stations.map(toCharger)
  },
}
