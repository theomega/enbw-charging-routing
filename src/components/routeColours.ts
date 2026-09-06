/**
 * The palette the map draws routes in, shared with the legend under it.
 *
 * One module so a swatch and the line it names can never drift apart.
 *
 * The chosen route is emerald; each alternative gets its own colour rather than
 * a shared "not selected" grey, because two identical lines leave the legend
 * unable to say which is which. They all stay bright: an alternative surfaces
 * only where it parts company with the selection, which is a short stretch of a
 * long line, and dimming it to "clearly secondary" loses it against the dark
 * basemap. Stroke weight carries the hierarchy instead of darkness.
 */

export const SELECTED_STROKE = '#22c55e'
export const ALTERNATIVE_STROKES = ['#cbd5e1', '#7dd3fc']

/** The colour each route is drawn in, in the order given. */
export function strokeColours(layers: readonly { selected: boolean }[]): string[] {
  let alternative = 0
  return layers.map((layer) =>
    layer.selected
      ? SELECTED_STROKE
      : ALTERNATIVE_STROKES[alternative++ % ALTERNATIVE_STROKES.length],
  )
}

/**
 * Charger dots carry the same three states as the list's availability badge.
 * `null` means the provider has no live data at all, which is a different
 * statement from "zero free" — never render the two the same way.
 */
export const CHARGER_FREE = '#34d399'
export const CHARGER_BUSY = '#fbbf24'
export const CHARGER_UNKNOWN = '#94a3b8'
