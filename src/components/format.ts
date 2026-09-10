/** Display helpers shared by the list and the cards. */

export function formatDistance(metres: number): string {
  if (metres < 1_000) return `${Math.round(metres / 10) * 10} m`
  if (metres < 10_000) return `${(metres / 1_000).toFixed(1)} km`
  return `${Math.round(metres / 1_000)} km`
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} h` : `${h} h ${m}`
}

/** Detour is the number people scan for, so keep it short and signed. */
export function formatDetour(seconds: number | null): string {
  if (seconds == null) return '—'
  const mins = Math.round(seconds / 60)
  if (mins <= 0) return 'on route'
  return `+${mins} min`
}

/** How much slower an alternative is than the fastest route. */
export function formatDurationDelta(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins <= 0) return 'fastest'
  if (mins < 60) return `+${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `+${h} h` : `+${h} h ${m}`
}

export function formatPower(kw: number | null): string {
  if (kw == null) return '? kW'
  return `${Math.round(kw)} kW`
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** How far into the drive a charger sits, as a share of the whole route. */
export function formatProgress(alongDistanceM: number, totalDistanceM: number): string {
  if (totalDistanceM <= 0) return '—'
  const pct = Math.round((alongDistanceM / totalDistanceM) * 100)
  return `${Math.min(100, Math.max(0, pct))}%`
}

/**
 * Marks a figure the app worked out from the route geometry rather than
 * measured on the road.
 *
 * The distinction is the same one `formatDetour` draws between "—" and "on
 * route": a driver deciding whether the battery reaches a charger deserves to
 * know which numbers were actually priced.
 */
export const asEstimate = (value: string): string => `≈ ${value}`

/**
 * A charge point's state, in words.
 *
 * EnBW's own vocabulary is SCREAMING_SNAKE and open-ended, so an unrecognised
 * value is title-cased rather than dropped: a point in a state this app has not
 * seen should still say something rather than vanish from the list.
 */
export function formatPointStatus(status: string | null): string {
  if (!status) return 'Unknown'
  const known: Record<string, string> = {
    AVAILABLE: 'Available',
    OCCUPIED: 'In use',
    OUT_OF_SERVICE: 'Out of service',
    UNKNOWN: 'Unknown',
  }
  return (
    known[status] ??
    status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  )
}
