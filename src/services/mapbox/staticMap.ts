import polyline from '@mapbox/polyline'
import simplify from '@turf/simplify'
import type { Feature, LineString } from 'geojson'
import { fromPosition } from '../../core/geo'
import { buildRouteGeometry, type Route } from '../../core/route'
import { optionalToken } from './client'

/**
 * Static route maps via the Mapbox Static Images API.
 *
 * No map library: the routes are baked into a PNG URL as encoded polyline
 * overlays, which costs one image request and zero bundle weight.
 *
 * One image can carry several routes at once, which is what makes the
 * alternatives comparable — the same picture shows where the Brenner and the
 * Jaufenpass part company. The chosen route is emerald and drawn last; the
 * alternatives are muted and drawn underneath it.
 *
 * The whole request must stay within a character limit, and an `overview=full`
 * geometry for a 1000 km route is far too large raw — let alone three of them —
 * so the paths are simplified (Turf's Douglas-Peucker) until they fit.
 * Simplification is for display only; the corridor maths always uses the full
 * geometry.
 */

const STYLE = 'mapbox/dark-v11'

/**
 * Mapbox documents a limit of 8,192 characters for the whole request. Aim well
 * under it: the exact ceiling has been reported inconsistently, and a URL that
 * is merely close to the limit is not worth the risk of a 414 in the field.
 */
export const URL_CHARACTER_BUDGET = 7_000

/**
 * The chosen route is emerald; each alternative gets its own colour.
 *
 * They stay bright. An alternative is drawn underneath the selection and only
 * surfaces where the two part company, which is a short stretch of a long line
 * — dimmed to "clearly secondary" it vanishes against the dark basemap, taking
 * the one thing the map exists to show with it. Stroke weight carries the
 * hierarchy instead of darkness.
 *
 * Two alternatives in the same colour would leave a legend unable to say which
 * line is which, so they differ rather than sharing one "not selected" grey.
 */
export const SELECTED_STROKE = '22c55e'
export const ALTERNATIVE_STROKES = ['cbd5e1', '7dd3fc']

/** Start is neutral, destination matches the selected route. */
const PIN_START = 'ffffff'
const PIN_END = SELECTED_STROKE

/**
 * The colour each route is drawn in, in the order given.
 *
 * Exported so a legend can point at the lines without restating the rule and
 * drifting out of step with the picture.
 */
export function strokeColours(layers: readonly { selected: boolean }[]): string[] {
  let alternative = 0
  return layers.map((layer) =>
    layer.selected
      ? SELECTED_STROKE
      : ALTERNATIVE_STROKES[alternative++ % ALTERNATIVE_STROKES.length],
  )
}

/** Encoded Polyline Algorithm Format, precision 5, as the Static Images API expects. */
const encode = (line: Feature<LineString>): string =>
  polyline.encode(line.geometry.coordinates.map(fromPosition).map((p) => [p.lat, p.lon]))

/** One route to draw, and whether it is the one the driver has chosen. */
export interface RouteLayer {
  route: Route
  selected: boolean
}

export interface StaticMapOptions {
  width?: number
  height?: number
  /**
   * Label the highlighted route's endpoints A and B. Worth it on a map big
   * enough to read; on a thumbnail the pins would swamp the line.
   */
  pins?: boolean
  /** Injectable so the budget logic is testable without a real token. */
  token?: string
  budget?: number
}

/**
 * Build a static image URL for one or more routes, simplifying until it fits
 * the budget.
 *
 * Returns null when no token is configured, so callers can fall back to a
 * text-only view rather than rendering a broken image.
 */
export function staticMapUrl(layers: RouteLayer[], options: StaticMapOptions = {}): string | null {
  const token = options.token ?? optionalToken()
  if (!token) return null

  const width = options.width ?? 160
  const height = options.height ?? 100
  const budget = options.budget ?? URL_CHARACTER_BUDGET

  // Colours are assigned in the caller's order, before the sort below can
  // disturb it, so they match what strokeColours() tells the legend.
  const colours = strokeColours(layers)

  // Mapbox paints overlays in the order given, so the chosen route has to come
  // last to sit on top of the alternatives it overlaps.
  const ordered = layers
    .map((layer, i) => ({ layer, colour: colours[i] }))
    .sort((a, b) => Number(a.layer.selected) - Number(b.layer.selected))

  // A single-vertex route has no line to draw. Dropping it here rather than
  // bailing out keeps one degenerate alternative from blanking the whole map.
  const drawn = ordered
    .map((entry) => ({ ...entry, line: buildRouteGeometry(entry.layer.route).line }))
    .filter((d): d is typeof d & { line: Feature<LineString> } => d.line !== null)
  if (drawn.length === 0) return null

  // Pins mark the highlighted route's ends — every alternative shares them,
  // since they all answer the same origin/destination pair.
  const highlighted = drawn[drawn.length - 1].line.geometry.coordinates
  const markers =
    options.pins === true
      ? [pin('a', PIN_START, highlighted[0]), pin('b', PIN_END, highlighted[highlighted.length - 1])]
      : []

  const build = (lines: Feature<LineString>[]): string => {
    const overlays = lines.map((line, i) => {
      // Thicker, so the chosen route reads first even where the alternatives
      // run alongside it for hundreds of kilometres.
      const weight = drawn[i].layer.selected ? 5 : 3
      return `path-${weight}+${drawn[i].colour}-0.95(${encodeURIComponent(encode(line))})`
    })
    return (
      `https://api.mapbox.com/styles/v1/${STYLE}/static/${[...overlays, ...markers].join(',')}` +
      `/auto/${width}x${height}@2x?access_token=${token}&attribution=false&logo=false`
    )
  }

  // Escalate the tolerance geometrically until the URL fits. Starting from zero
  // means a short route pays nothing for simplification it does not need.
  //
  // Each pass simplifies the *previous* result rather than the original: a
  // 20,000-point geometry would otherwise be walked from scratch on every
  // attempt. Cascading shrinks the input each round and is still a valid
  // simplification, since Douglas-Peucker at a higher tolerance is a superset
  // of the points a lower one would have dropped.
  //
  // Every route is simplified by the same amount. They share one budget, so
  // sparing the selected one would have to come out of the alternatives — and
  // a comparison map is only honest if all of its lines are equally faithful.
  let lines = drawn.map((d) => d.line)
  let tolerance = 0
  for (let attempt = 0; attempt < 24; attempt++) {
    const url = build(lines)
    if (url.length <= budget) return url
    tolerance = tolerance === 0 ? 0.0001 : tolerance * 2
    lines = lines.map((line) => simplify(line, { tolerance, highQuality: false, mutate: false }))
  }

  // Pathological fallback: endpoints only still shows roughly where each route
  // goes.
  return build(
    drawn.map(({ line }) => {
      const ends = line.geometry.coordinates
      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [ends[0], ends[ends.length - 1]] },
      }
    }),
  )
}

/** `pin-s-a+cbd5e1(11.35,46.68)` — a small labelled marker. */
const pin = (label: string, colour: string, [lon, lat]: number[]): string =>
  `pin-s-${label}+${colour}(${lon.toFixed(5)},${lat.toFixed(5)})`
