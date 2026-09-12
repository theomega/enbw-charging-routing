/**
 * The palette the map draws routes in, shared with the legend under it.
 *
 * One module so a swatch and the line it names can never drift apart.
 *
 * The chosen route is emerald; each alternative gets its own colour rather than
 * a shared "not selected" grey, because two identical lines leave the legend
 * unable to say which is which. An alternative surfaces only where it parts
 * company with the selection, which is a short stretch of a long line, so none
 * of them may be dimmed to "clearly secondary" — that loses them against the
 * basemap altogether. Stroke weight carries the hierarchy instead.
 *
 * All three are therefore chosen to hold up against the *light* basemap the
 * app now draws (see `STYLE` in RouteMap): the alternatives are the darker end
 * of their ramps, where slate-300 and sky-300 used to be, because on white
 * ground a pale line is not a subtle line, it is an absent one.
 */

export const SELECTED_STROKE = '#22c55e'
export const ALTERNATIVE_STROKES = ['#475569', '#0284c7']

/** The colour each route is drawn in, in the order given. */
export function strokeColours(layers: readonly { selected: boolean }[]): string[] {
  let alternative = 0
  return layers.map((layer) =>
    layer.selected
      ? SELECTED_STROKE
      : ALTERNATIVE_STROKES[alternative++ % ALTERNATIVE_STROKES.length],
  )
}
