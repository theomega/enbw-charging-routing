import type { ChargerOnRoute } from './types'

/**
 * Which chargers survive the user's settings.
 *
 * Split in two because the data arrives in two waves, and the split is what
 * decides which stations are worth spending an occupancy request on.
 */

/** The subset of Settings that filtering actually reads. */
export interface ChargerFilters {
  minPowerKw: number
  /** null = no cap. */
  maxDetourMinutes: number | null
}

/**
 * Filters that need only the shipped station list, so they run before any
 * network call.
 *
 * The list itself is already built to a 50 kW floor (see
 * services/enbw/stations.ts), so this only ever raises it further — to 100,
 * 150 or 300 kW, for someone who will not stop for anything slower.
 *
 * Runs before enrichment, so it also decides which rows are worth spending an
 * occupancy lookup on.
 */
export function applyStaticFilters(
  items: ChargerOnRoute[],
  filters: Pick<ChargerFilters, 'minPowerKw'>,
): ChargerOnRoute[] {
  if (filters.minPowerKw <= 0) return items
  return items.filter(
    // Unknown power is kept rather than guessed at; the badge shows "? kW".
    ({ charger }) => charger.maxPowerKw == null || charger.maxPowerKw >= filters.minPowerKw,
  )
}

/**
 * Filters that need the priced detour, which only exists after the Matrix call.
 *
 * An unpriced row is kept rather than hidden: `null` means "not measured", and
 * the cap must not silently drop the rows past the pricing limit.
 */
export function applyLiveFilters(
  items: ChargerOnRoute[],
  filters: Pick<ChargerFilters, 'maxDetourMinutes'>,
): ChargerOnRoute[] {
  if (filters.maxDetourMinutes == null) return items
  const capS = filters.maxDetourMinutes * 60
  return items.filter(({ detourS }) => detourS == null || detourS <= capS)
}

/**
 * Whether the settings are hiding anything, for the indicator on the settings
 * button.
 *
 * `defaults` is the loosest setting the UI offers, not "off": the shipped list
 * already stops at 50 kW, so `minPowerKw: 50` excludes nothing and must not
 * light the indicator. It is a parameter rather than a constant here because
 * that number is the store's to decide — core must not import state.
 *
 * The fields are compared one by one on purpose. A shallow diff over
 * `Object.keys(defaults)` would also read `mapsApp` off a `Settings` passed as
 * a `ChargerFilters`, and picking a maps app would light the indicator.
 */
export function isFiltering(filters: ChargerFilters, defaults: ChargerFilters): boolean {
  // `>` rather than `!==`, because the power chips only ever raise the floor.
  return (
    filters.minPowerKw > defaults.minPowerKw ||
    filters.maxDetourMinutes !== defaults.maxDetourMinutes
  )
}
