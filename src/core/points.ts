import type { Charger } from './types'

/**
 * How many of a station's Ladesäulen the Ladeleistung setting actually leaves,
 * and how many of *those* are free.
 *
 * The badge used to render EnBW's station-level counts — `availableChargePoints`
 * over `numberOfChargePoints` — which count every point at the station. A
 * motorway hub with four 300 kW stalls and four 22 kW AC posts therefore read
 * "4/8" at the default 50 kW setting, and half of that eight was never a stop
 * anyone driving would make. `applyStaticFilters` decides whether the *station*
 * is listed, by its own `maxPowerKw`; nothing until now narrowed the count.
 *
 * Two sources, and nothing else is trusted:
 *
 *   the live record   power *and* status per point  ->  both numbers
 *   the shipped list  power per point               ->  the denominator
 *
 * Only the first can produce a free count, because only it knows which of the
 * fast points is occupied. That is not a regression: a row with no live record
 * shows "?" for the free count either way, and with the shipped powers it now
 * shows that "?" over a denominator that means what it says.
 *
 * With neither, both numbers are unknown. EnBW's station-level counts are not a
 * fallback: they are the numbers this whole module exists to stop displaying —
 * `availableChargePoints` over `numberOfChargePoints`, every AC post included —
 * and the handful of stations in that state are the ones whose detail lookup
 * failed during the build *and* has failed since. "?" is the honest badge for
 * them.
 */

/**
 * EnBW's word for a free point.
 *
 * Shared with `components/chargePointGroups.ts`, which counts the same thing
 * per (connector, power) group: two copies of this string would let the badge
 * and the group lines below it disagree about what "free" is.
 */
export const POINT_AVAILABLE = 'AVAILABLE'

export interface PointCount {
  /**
   * Points at or above the setting. `null` when the station's points are not
   * known at all, which is a different statement from a station that has none.
   */
  total: number | null
  /**
   * How many of those are free. Null when it cannot be known — no live record,
   * or one that reports no status at all — which the badge draws as "?" and
   * must never draw as zero.
   */
  free: number | null
}

/**
 * Unknown power is kept rather than guessed at, exactly as `applyStaticFilters`
 * keeps a station whose `maxPowerKw` is null. "Might be fast" is not a reason to
 * drop a stall from a count the driver is choosing on.
 */
const matches = (maxPowerKw: number | null, minPowerKw: number): boolean =>
  maxPowerKw == null || maxPowerKw >= minPowerKw

export function matchingPoints(charger: Charger, minPowerKw: number): PointCount {
  if (charger.chargePoints) {
    const points = charger.chargePoints.filter((p) => matches(p.maxPowerKw, minPowerKw))
    if (points.length > 0) {
      // Same rule as `groupChargePoints`: a set in which not one point carries
      // a state is unknown, never "none free".
      const reported = points.some((p) => p.status != null)
      return {
        total: points.length,
        free: reported ? points.filter((p) => p.status === POINT_AVAILABLE).length : null,
      }
    }
  }

  if (charger.pointPowers) {
    let total = 0
    let excluded = 0
    for (const group of charger.pointPowers) {
      if (matches(group.maxPowerKw, minPowerKw)) total += group.count
      else excluded += group.count
    }
    if (total > 0) {
      return {
        // With nothing excluded, the station-level free count *is* the count of
        // free fast points, so the badge keeps the number it always had. Once
        // anything is excluded that number cannot be attributed — EnBW says how
        // many points are free, never which — and the free count has to admit
        // it is unknown rather than credit an occupied 22 kW post to the fast
        // stalls.
        total,
        free: excluded === 0 ? charger.availablePoints : null,
      }
    }
  }

  // Either there is no per-point data, or none of it survived the filter. The
  // second cannot be true of a station that is in the list at all — every
  // listed station has a numeric `maxPowerKw` at or above the floor
  // (`parseStationList`), which is the power of its own fastest point, and
  // `applyStaticFilters` only keeps stations that clear the setting with it. So
  // it means EnBW's two endpoints contradict each other about this station, and
  // "0/0" would publish that contradiction as a fact about it.
  return { total: null, free: null }
}
