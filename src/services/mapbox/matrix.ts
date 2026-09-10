import { MATRIX_MAX_COORDS, type MatrixFn } from '../../core/detour'
import { MapboxError, coordPair, getJson, requireToken } from './client'

/**
 * Duration and distance matrix on the `driving` profile — the Mapbox side of
 * detour pricing.
 *
 * Deliberately not `driving-traffic`: that profile caps matrix requests at 10
 * coordinates instead of 25, which would roughly triple the request count for
 * the same set of chargers. The headline route still uses traffic.
 *
 * Both annotations are asked for because Mapbox bills the Matrix API per
 * *element*, not per annotation: the distances arrive on the request that was
 * being made anyway, at no extra quota. They are what lets the detail panel
 * answer "can I reach this on what is in the battery" with a road distance
 * rather than a crow-fly guess.
 */

interface MatrixResponse {
  code?: string
  message?: string
  /** [source][destination], seconds. null where no route exists. */
  durations: (number | null)[][] | null
  /** [source][destination], metres. Absent if the annotation was refused. */
  distances?: (number | null)[][] | null
}

export const fetchMatrix: MatrixFn = async (query, signal) => {
  const { coordinates, sources, destinations } = query
  if (coordinates.length > MATRIX_MAX_COORDS) {
    throw new MapboxError(
      `Matrix accepts at most ${MATRIX_MAX_COORDS} coordinates, got ${coordinates.length}`,
    )
  }
  if (coordinates.length < 2) throw new MapboxError('Matrix needs at least 2 coordinates')

  const path = coordinates.map(coordPair).join(';')
  const url = new URL(
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${encodeURIComponent(path)}`,
  )
  url.searchParams.set('access_token', requireToken())
  url.searchParams.set('annotations', 'duration,distance')
  url.searchParams.set('sources', sources.join(';'))
  url.searchParams.set('destinations', destinations.join(';'))

  const body = await getJson<MatrixResponse>(url.toString(), signal)
  if (!body.durations) throw new MapboxError(body.message ?? 'Matrix returned no durations')
  // Durations are load-bearing — the detour cannot be priced without them — but
  // distances are decoration on top, so a response missing them degrades the
  // detail panel rather than failing the whole search.
  return { durations: body.durations, distances: body.distances ?? null }
}
