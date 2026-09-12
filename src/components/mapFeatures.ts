import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { ChargerOnRoute } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { DOT_COLOUR, availabilityState } from './availability'
import { strokeColours } from './routeColours'

/**
 * What the map is asked to draw, as plain GeoJSON.
 *
 * Split out from the component because this is the part with decisions in it —
 * which colour, which state — and none of it needs a WebGL context to be
 * checked. RouteMap is left as wiring: create, setData, remove.
 */

/** Feature properties the style expressions in RouteMap read by name. */
export interface RouteProperties {
  id: string
  selected: boolean
  colour: string
}

export function routeFeatures(
  routes: RouteOption[],
  selectedId: string | null,
): FeatureCollection<LineString> {
  const colours = strokeColours(routes.map((r) => ({ selected: r.id === selectedId })))
  return {
    type: 'FeatureCollection',
    features: routes.map<Feature<LineString>>((option, i) => ({
      type: 'Feature',
      properties: {
        id: option.id,
        selected: option.id === selectedId,
        colour: colours[i],
      } satisfies RouteProperties,
      geometry: { type: 'LineString', coordinates: option.route.coordinates },
    })),
  }
}

/** Feature properties the charger layers read by name. */
export interface ChargerProperties {
  /** The charger id, so a tap on a dot can name the row it belongs to. */
  id: string
  colour: string
}

export function chargerFeatures(chargers: ChargerOnRoute[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: chargers.map<Feature<Point>>((item) => ({
      type: 'Feature',
      properties: {
        id: item.charger.id,
        colour: dotColour(item),
      } satisfies ChargerProperties,
      geometry: { type: 'Point', coordinates: [item.charger.lon, item.charger.lat] },
    })),
  }
}

/** The same states as the list's availability badge, in the shared palette. */
const dotColour = ({ charger }: ChargerOnRoute): string =>
  DOT_COLOUR[availabilityState(charger.availablePoints)]

/**
 * Identifies the set of routes on screen, so the view is framed once per set.
 * Re-framing when the driver merely picks a different alternative would yank
 * the view out from under the tap that picked it.
 */
export const framingKey = (routes: RouteOption[]): string => routes.map((r) => r.id).join('|')
