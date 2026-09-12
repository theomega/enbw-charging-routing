/**
 * The four availability states, and what each one looks like wherever it is
 * drawn: a dot on the map, the badge on a list row, the group line in the
 * detail panel.
 *
 * One module because it is one fact in three places, and a driver reading a
 * green dot and then an amber badge for the same Ladestation takes the
 * difference as a change in the data.
 *
 * `null` means the provider has no live data at all, which is a different
 * statement from "zero free" — never render the two the same way.
 *
 * `low` is its own state because one free Ladesäule is a bet rather than a
 * parking spot: it can be taken in the half hour it takes to get there, and
 * that is worth seeing while choosing between two stations, not after.
 *
 * The hues are shared; the shades are not, and must not be. Dots sit on the
 * light basemap and need the saturated end of each ramp to be seen at all,
 * while badges sit on the dark panel and are drawn the other way round, as a
 * dark ground under a light number.
 */

export type AvailabilityState = 'unknown' | 'none' | 'low' | 'free'

export function availabilityState(free: number | null): AvailabilityState {
  if (free == null) return 'unknown'
  if (free === 0) return 'none'
  if (free === 1) return 'low'
  return 'free'
}

/** Map dots. Hex, because Mapbox paint properties take no class names. */
export const DOT_COLOUR: Record<AvailabilityState, string> = {
  unknown: '#94a3b8',
  none: '#f43f5e',
  low: '#fbbf24',
  free: '#34d399',
}

/** The list row's badge. */
export const BADGE_TONE: Record<AvailabilityState, string> = {
  unknown: 'bg-slate-800 text-slate-400',
  none: 'bg-rose-950 text-rose-300 font-semibold',
  low: 'bg-amber-950 text-amber-300 font-semibold',
  free: 'bg-emerald-950 text-emerald-300 font-semibold',
}

/** The detail panel's group line, which is text on the panel's own ground. */
export const TEXT_TONE: Record<AvailabilityState, string> = {
  unknown: 'text-slate-500',
  none: 'text-rose-400',
  low: 'text-amber-400',
  free: 'text-emerald-400',
}
