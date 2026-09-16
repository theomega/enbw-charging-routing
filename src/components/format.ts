/**
 * Display helpers shared by the list and the cards.
 *
 * Code is English and the UI is German (see CLAUDE.md), so the names here are
 * English and everything they return is not. There is one formatter per figure
 * and no locale switch: the app is German-only, and a second set of these was
 * the thing that let the panel and the list disagree about what "4.5 km" means.
 */

/** German decimal comma; whole kilometres above 10 km carry no decimal at all. */
export function formatDistance(metres: number): string {
  if (metres < 1_000) return `${Math.round(metres / 10) * 10} m`
  if (metres < 10_000) return `${(metres / 1_000).toFixed(1).replace('.', ',')} km`
  return `${Math.round(metres / 1_000)} km`
}

/**
 * A duration as "45 min", "2 h", "2 h 12 min".
 *
 * Time is written in SI/ISO symbols throughout the app — `h` and `min`, never
 * the German `Std.`/`Min.` — so a duration reads the same in every figure the
 * UI shows and survives the app being read in another language. Symbols take a
 * space and carry no full stop; that is what distinguishes them from an
 * abbreviation, and `Min.` would be one.
 */
export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Detour is the number people scan for, so keep it short and signed. */
export function formatDetour(seconds: number | null): string {
  if (seconds == null) return '—'
  const mins = Math.round(seconds / 60)
  if (mins <= 0) return 'kein Umweg'
  return `+${mins} min`
}

/** How much slower an alternative is than the fastest route. SI units, as above. */
export function formatDurationDelta(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins <= 0) return 'schnellste'
  if (mins < 60) return `+${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `+${h} h` : `+${h} h ${m} min`
}

export function formatPower(kw: number | null): string {
  if (kw == null) return '? kW'
  return `${Math.round(kw)} kW`
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Marks a figure the app worked out from the route geometry rather than
 * measured on the road. A driver deciding whether the battery reaches a
 * charger deserves to know which numbers were actually priced.
 */
export const asEstimate = (value: string): string => `≈ ${value}`

/**
 * A distance, measured where the Matrix priced it and estimated where it did
 * not.
 *
 * Rows past ENRICHED_LIMIT were never sent to the Matrix, so every distance the
 * UI shows is one of these two things and has to say which. The rule lives here
 * rather than at each call site, which is where it drifted before: `measured`
 * wins whenever it exists, a null `estimate` means there was no route to work
 * one out from, and only the fallback is marked.
 */
export function distanceOrEstimate(
  measured: number | null | undefined,
  estimate: number | null,
): string {
  if (measured != null) return formatDistance(measured)
  if (estimate == null) return '—'
  return asEstimate(formatDistance(estimate))
}

/**
 * A charge point's state, in words.
 *
 * EnBW's own vocabulary is SCREAMING_SNAKE and open-ended, so an unrecognised
 * value is title-cased rather than dropped: a point in a state this app has not
 * seen should still say something rather than vanish from the list.
 *
 * That fallback prints EnBW's word, which is English — "BLOCKED" surfaced in
 * the German panel as "blocked" before it was added below. It is the right
 * behaviour (silence would be worse than a foreign word), but it means the map
 * has to grow whenever the provider uses a state nobody has seen yet. A stray
 * English word on this line is the signal that it has.
 */
export function formatPointStatus(status: string | null): string {
  if (!status) return 'Unbekannt'
  const known: Record<string, string> = {
    AVAILABLE: 'Frei',
    OCCUPIED: 'Belegt',
    OUT_OF_SERVICE: 'Außer Betrieb',
    BLOCKED: 'Blockiert',
    UNKNOWN: 'Unbekannt',
  }
  return (
    known[status] ??
    status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  )
}
