import { useEffect, useRef, useState } from 'react'
import { DEFAULT_MAX_OFFSET_M, buildCorridor, placeChargersOnRoute } from '../core/corridor'
import type { ChargerOnRoute } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { loadStations } from '../services/enbw/stations'

export interface CorridorPlacement {
  /** Every shipped charger within the corridor, in the order you drive past them. */
  placed: ChargerOnRoute[]
  /** 0..1 while working, null when idle or done. Drives the progress bar. */
  progress: number | null
  working: boolean
  error: string | null
}

/**
 * Put the shipped station list on the selected route.
 *
 * No network call at all beyond loading the list once: this is Turf on data
 * already in memory (see core/corridor.ts). It is not instant — a long route
 * against 4,600 stations is a few hundred milliseconds on a phone — so it
 * reports progress and hands the main thread back as it goes.
 *
 * Results are cached per route id, so flipping between alternatives after the
 * first look is free.
 */
export function useCorridor(
  selected: RouteOption | null,
  maxOffsetM = DEFAULT_MAX_OFFSET_M,
): CorridorPlacement {
  const [placed, setPlaced] = useState<ChargerOnRoute[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cache = useRef(new Map<string, ChargerOnRoute[]>())

  useEffect(() => {
    if (!selected) {
      setPlaced([])
      setProgress(null)
      setWorking(false)
      return
    }

    const cached = cache.current.get(selected.id)
    if (cached) {
      setPlaced(cached)
      setProgress(null)
      setWorking(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        setError(null)
        setWorking(true)
        setProgress(0)

        const list = await loadStations(controller.signal)
        if (cancelled) return

        const corridor = buildCorridor(selected.route, maxOffsetM)
        const next = await placeChargersOnRoute(corridor, list.chargers, {
          signal: controller.signal,
          onProgress: (fraction) => {
            if (!cancelled) setProgress(fraction)
          },
        })
        if (cancelled) return

        cache.current.set(selected.id, next)
        setPlaced(next)
      } catch (err) {
        if (cancelled || controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) {
          setWorking(false)
          setProgress(null)
        }
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selected, maxOffsetM])

  return { placed, progress, working, error }
}
