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

export function formatPower(kw: number | null): string {
  if (kw == null) return '? kW'
  return `${Math.round(kw)} kW`
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
