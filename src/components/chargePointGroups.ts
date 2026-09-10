/**
 * The charge points of one station, collapsed to what a driver reads.
 *
 * A motorway hub can list forty points, and thirty-eight of them are the same
 * sentence: same connector, same power. Rendering one row each turns the detail
 * panel into a scroll past near-identical lines and pushes the map, the route
 * figures and the navigate button off the screen. Grouped, the same station is
 * three or four rows that answer the actual question — what can I plug into
 * here, how fast, and how many of those are free right now.
 *
 * The EVSE id is the one thing lost in the collapse. It identifies the stall
 * you drive up to, but it is only useful once you have arrived, and it is the
 * single field that makes every point distinct — keeping it would defeat the
 * grouping entirely.
 */

import type { ChargePoint } from '../core/types'
import { formatPointStatus } from './format'

/** EnBW's word for a free point. Every other state is reported as it comes. */
const AVAILABLE = 'AVAILABLE'

/**
 * The bucket a point with no reported state falls into. EnBW's own `UNKNOWN`
 * lands here too: it is the same word on screen, and splitting "the provider
 * said unknown" from "the provider said nothing" would be a distinction with
 * no display to hang it on.
 */
const UNKNOWN = 'UNKNOWN'

export interface ChargePointGroup {
  /** Stable across renders and unique within a station. */
  key: string
  /** Plug names in the provider's own order, e.g. ["CCS (Typ 2)"]. */
  plugs: string[]
  maxPowerKw: number | null
  /** How many physical points are in this group. */
  count: number
  /**
   * Points reported free. `null` when not one point in the group carries a
   * state — the same distinction the station badge draws, where "?" and "0
   * free" must never render alike.
   */
  free: number | null
  /** Every other state present, with its count. Sums with `free` to `count`. */
  others: { status: string; count: number }[]
}

/** Internal accumulator: the same shape, with the counting still in progress. */
interface Bucket {
  key: string
  plugs: string[]
  maxPowerKw: number | null
  count: number
  free: number
  /** True once any point in the bucket reported a state at all. */
  reported: boolean
  others: Map<string, number>
}

/**
 * One row per (connector set, power) combination, fastest first.
 *
 * The Worker has already reduced each point to a plug list and a single power
 * figure (`worker/index.ts`), so a point is one connector set at one speed and
 * grouping is the only step left.
 */
export function groupChargePoints(points: ChargePoint[]): ChargePointGroup[] {
  const buckets = new Map<string, Bucket>()

  for (const point of points) {
    const key = groupKey(point)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        key,
        // Copied, so the group never aliases the fetched record.
        plugs: [...point.plugs],
        maxPowerKw: point.maxPowerKw,
        count: 0,
        free: 0,
        reported: false,
        others: new Map(),
      }
      buckets.set(key, bucket)
    }

    bucket.count += 1
    if (point.status === AVAILABLE) {
      bucket.reported = true
      bucket.free += 1
    } else {
      // An unreported point still has to be counted somewhere, or the
      // breakdown stops adding up to the number of points beside it.
      const status = point.status ?? UNKNOWN
      if (point.status != null) bucket.reported = true
      bucket.others.set(status, (bucket.others.get(status) ?? 0) + 1)
    }
  }

  return [...buckets.values()]
    .map((bucket) => ({
      key: bucket.key,
      plugs: bucket.plugs,
      maxPowerKw: bucket.maxPowerKw,
      count: bucket.count,
      free: bucket.reported ? bucket.free : null,
      others: [...bucket.others]
        .map(([status, count]) => ({ status, count }))
        // Commonest state first, then alphabetical, so the line is stable
        // between refreshes that come back with the same numbers.
        .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    }))
    .sort(byPowerThenPlugs)
}

/**
 * The plugs are sorted for the key but not for display: two points listing the
 * same connectors in a different order are the same kind of stall and belong
 * in one group, while the order EnBW gives is the order to show.
 *
 * An unknown power is its own bucket rather than being folded into any figure.
 */
function groupKey(point: ChargePoint): string {
  return `${[...point.plugs].sort().join('|')}@${point.maxPowerKw ?? UNKNOWN}`
}

/** Fastest first — the order a driver scans in. Unknown power goes last. */
function byPowerThenPlugs(a: ChargePointGroup, b: ChargePointGroup): number {
  if (a.maxPowerKw !== b.maxPowerKw) {
    if (a.maxPowerKw == null) return 1
    if (b.maxPowerKw == null) return -1
    return b.maxPowerKw - a.maxPowerKw
  }
  return a.plugs.join(' · ').localeCompare(b.plugs.join(' · '))
}

/**
 * The group's second line: how many points, how many free, and what the rest
 * are doing.
 *
 * The free count leads because it is the only number that changes while you
 * drive towards the station. States other than free are named only when they
 * occur, so a fully free group reads as one short clause rather than a row of
 * zeroes.
 */
export function describeGroup(group: ChargePointGroup): string {
  const points = `${group.count} ${group.count === 1 ? 'point' : 'points'}`
  // Nothing reported at all: saying "0 of 4 free" here would state a fact the
  // provider never gave.
  if (group.free == null) return `${points} · status unknown`

  const rest = group.others.map(
    ({ status, count }) => `${count} ${formatPointStatus(status).toLowerCase()}`,
  )
  return [points, `${group.free} of ${group.count} free`, ...rest].join(' · ')
}
