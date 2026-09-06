import { useEffect, useRef, useState } from 'react'

/**
 * The rendered size of an element, for the callers that have to ask for an
 * image at a pixel size rather than letting CSS stretch one.
 *
 * Sizes are quantised: a static map is one HTTP request per distinct URL, and
 * an unrounded width would order a new PNG for every frame of a window drag or
 * an address-bar collapse. A step is small enough to be invisible at @2x.
 */

const STEP = 16

/** The Static Images API refuses dimensions above this, retina or not. */
const MAX_STATIC_PX = 1280

export interface Size {
  width: number
  height: number
}

const quantise = (px: number): number =>
  Math.min(Math.max(Math.ceil(px / STEP) * STEP, STEP), MAX_STATIC_PX)

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      const width = quantise(el.clientWidth)
      const height = quantise(el.clientHeight)
      // Same object identity for an unchanged size, so a resize that quantises
      // to what we already have does not re-render.
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }))
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, size] as const
}
