import { useCallback, useEffect, useRef, useState } from 'react'
import { distanceM } from '../core/geo'
import type { LatLon } from '../core/types'

export interface GeolocationState {
  position: LatLon | null
  accuracyM: number | null
  error: string | null
  /**
   * The browser answered with a stored refusal instead of asking. iOS Safari
   * does this silently — no prompt appears, ever — so this is what tells the UI
   * to explain the settings rather than to wait for a fix.
   */
  blocked: boolean
  /** True until the first fix or the first failure. */
  loading: boolean
  /** Starts a fresh watch, which re-prompts once the block is lifted. */
  retry: () => void
}

const BLOCKED =
  'Zugriff auf deinen Standort ist gesperrt. Safari fragt in diesem Fall nicht mehr nach — bitte in den Einstellungen freigeben:'

function describe(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return BLOCKED
    case err.POSITION_UNAVAILABLE:
      return 'Dein Standort ist im Moment nicht verfügbar.'
    case err.TIMEOUT:
      return 'Es kam keine GPS-Position an.'
    default:
      return err.message || 'Dein Standort konnte nicht bestimmt werden.'
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
  const [state, setState] = useState({
    position: null as LatLon | null,
    accuracyM: null as number | null,
    error: null as string | null,
    blocked: false,
    loading: true,
  })
  const lastRef = useRef<LatLon | null>(null)
  const blockedRef = useRef(false)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => {
    blockedRef.current = false
    setState((s) => ({ ...s, error: null, blocked: false, loading: true }))
    setAttempt((a) => a + 1)
  }, [])

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState({
        position: null,
        accuracyM: null,
        error: 'Dieser Browser kann keinen Standort bestimmen.',
        blocked: false,
        loading: false,
      })
      return
    }

    const markBlocked = () => {
      blockedRef.current = true
      setState((s) => ({ ...s, error: BLOCKED, blocked: true, loading: false }))
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        blockedRef.current = false
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude }
        const last = lastRef.current
        if (last && distanceM(last, next) < minMoveM) {
          // Still clear the loading flag on the first fix even if we ignore it.
          setState((s) => (s.loading ? { ...s, loading: false } : s))
          return
        }
        lastRef.current = next
        setState({
          position: next,
          accuracyM: pos.coords.accuracy,
          error: null,
          blocked: false,
          loading: false,
        })
      },
      (err) => {
        blockedRef.current = err.code === err.PERMISSION_DENIED
        setState((s) => ({
          ...s,
          error: describe(err),
          blocked: blockedRef.current,
          loading: false,
        }))
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    )

    // The Permissions API is the only way to see a stored refusal for what it
    // is before the watch answers, and the only way to notice the user lifting
    // it: granting location in the system settings fires no geolocation
    // callback, so without the change event a blocked session stays blocked
    // until a reload. Both are best-effort — a browser that has no geolocation
    // entry here still reports PERMISSION_DENIED through the error handler.
    let permission: PermissionStatus | null = null
    let cancelled = false
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return
        permission = status
        if (status.state === 'denied') markBlocked()
        status.onchange = () => {
          if (status.state !== 'denied' && blockedRef.current) retry()
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (permission) permission.onchange = null
      navigator.geolocation.clearWatch(id)
    }
  }, [minMoveM, attempt, retry])

  return { ...state, retry }
}
