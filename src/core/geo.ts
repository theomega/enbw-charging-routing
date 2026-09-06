import distance from '@turf/distance'
import { lineString, point } from '@turf/helpers'
import type { Feature, LineString, Point, Position } from 'geojson'
import type { LatLon } from './types'

/**
 * The seam between this app's `{ lat, lon }` and TurfJS.
 *
 * Turf — like GeoJSON — orders coordinates `[lon, lat]`, which is the reverse
 * of how the rest of the app (and every URL Mapbox and EnBW take) says it.
 * Swapping is a one-character mistake that produces a plausible-looking point
 * in the wrong hemisphere, so it happens here and nowhere else: no file outside
 * this one should index a raw coordinate pair.
 */

export const toPosition = (p: LatLon): Position => [p.lon, p.lat]

export const fromPosition = ([lon, lat]: Position): LatLon => ({ lat, lon })

export const toPoint = (p: LatLon): Feature<Point> => point(toPosition(p))

export const toLine = (path: LatLon[]): Feature<LineString> => lineString(path.map(toPosition))

/** Great-circle metres between two points. */
export const distanceM = (a: LatLon, b: LatLon): number =>
  distance(toPoint(a), toPoint(b), { units: 'meters' })

/** Metres between two raw GeoJSON positions, for code already holding them. */
export const positionDistanceM = (a: Position, b: Position): number =>
  distance(point(a), point(b), { units: 'meters' })
