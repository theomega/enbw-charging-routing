import { useEffect, useRef, useState } from 'react'
import { distanceM } from '../core/geo'
import type { LatLon } from '../core/types'

export interface GeolocationState {
  position: LatLon | null
  accuracyM: number | null
  error: string | null
  /** True until the first fix or the first failure. */
  loading: boolean
}

function describe(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission denied. Allow location access to see chargers ahead of you.'
    case err.POSITION_UNAVAILABLE:
      return 'Your position is unavailable right now.'
    case err.TIMEOUT:
      return 'Timed out waiting for a GPS fix.'
    default:
      return err.message || 'Could not determine your position.'
  }
}

/**
 * Continuous position watch.
 *
 * Updates are throttled to ~50 m of movement: the route and the along-route
 * figures are recomputed from this value, and re-running that on every GPS
 * tick would burn API quota for no visible change.
 */
export function useGeolocation(minMoveM = 50): GeolocationState {
  const [state, setState] = useState<GeolocationState>({
    position: null,
    accuracyM: null,
    error: null,
    loading: true,
  })
  const lastRef = useRef<LatLon | null>(null)

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState({
        position: null,
        accuracyM: null,
        error: 'This browser has no geolocation support.',
        loading: false,
      })
      return
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        const last = lastRef.current
        if (last && distanceM(last, next) < minMoveM) {
          // Still clear the loading flag on the first fix even if we ignore it.
          setState((s) => (s.loading ? { ...s, loading: false } : s))
          return
        }
        lastRef.current = next
        setState({ position: next, accuracyM: pos.coords.accuracy, error: null, loading: false })
      },
      (err) => setState((s) => ({ ...s, error: describe(err), loading: false })),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [minMoveM])

  return state
}
