import { useEffect, useState } from 'react'
import { distanceM } from '../core/geo'
import type { LatLon } from '../core/types'

/**
 * How far the driver must move before the Matrix is asked again.
 *
 * Detour pricing is the one thing left that genuinely needs a moving origin:
 * `legs.toChargerM` is "how far to it from here", and the Matrix is the only
 * thing that knows. It cannot simply take the live position, because
 * `detourCacheKey` rounds an origin to ~111 m — a live origin would miss the
 * cache every hundred metres and re-spend eight Matrix requests, about twenty
 * times what stepping costs.
 *
 * Two kilometres is what the route refetch used to step by, so nothing
 * regresses: "Zur Ladestation" was already up to this stale, and the request
 * count is unchanged. What is gone is the route refetch that used to ride along
 * with it.
 */
export const MATRIX_STEP_M = 2_000

/**
 * A position that only moves in steps, so anything keyed on it can cache.
 *
 * Adopts the first fix immediately — there is nothing to be stale against yet
 * — and afterwards holds still until the driver has moved a full step. Returns
 * the same object identity in between, which is what lets effects downstream
 * use it as a dependency directly.
 */
export function useSteppedOrigin(position: LatLon | null, stepM = MATRIX_STEP_M): LatLon | null {
  const [origin, setOrigin] = useState<LatLon | null>(null)

  useEffect(() => {
    if (!position) return
    // Deliberately not clearing on a null position: a momentary loss of GPS is
    // not a reason to throw away a perfectly good origin and re-price
    // everything when the fix comes back.
    setOrigin((current) => (current && distanceM(current, position) < stepM ? current : position))
  }, [position, stepM])

  return origin
}
