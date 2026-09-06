import { MATRIX_MAX_COORDS, type MatrixFn } from '../../core/detour'
import { MapboxError, coordPair, getJson, requireToken } from './client'

/**
 * Duration matrix on the `driving` profile — the Mapbox side of detour pricing.
 *
 * Deliberately not `driving-traffic`: that profile caps matrix requests at 10
 * coordinates instead of 25, which would roughly triple the request count for
 * the same set of chargers. The headline route still uses traffic.
 */

interface MatrixResponse {
  code?: string
  message?: string
  /** [source][destination], seconds. null where no route exists. */
  durations: (number | null)[][] | null
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
  url.searchParams.set('annotations', 'duration')
  url.searchParams.set('sources', sources.join(';'))
  url.searchParams.set('destinations', destinations.join(';'))

  const body = await getJson<MatrixResponse>(url.toString(), signal)
  if (!body.durations) throw new MapboxError(body.message ?? 'Matrix returned no durations')
  return body.durations
}
