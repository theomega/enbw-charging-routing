import bbox from '@turf/bbox'
import buffer from '@turf/buffer'
import type { FeatureCollection } from 'geojson'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useEffect, useRef, useState } from 'react'
import { toPoint } from '../core/geo'
import type { ChargerOnRoute, LatLon } from '../core/types'
import type { RouteOption } from '../services/mapbox/directions'
import { optionalToken } from '../services/mapbox/client'
import { chargerFeatures, framingKey, routeFeatures } from './mapFeatures'

/**
 * The route, drawn with a real map.
 *
 * One component serves both places a map appears — the picker in the page and
 * the full-screen sheet — because they want the same picture and differ only in
 * how much the driver is allowed to do to it. See `cooperativeGestures`.
 *
 * Everything is drawn as GeoJSON layers rather than DOM markers. A route can
 * carry hundreds of chargers, and that many absolutely-positioned elements
 * fighting the map's own transform is what makes embedded maps feel broken on a
 * phone. The one exception is the driver's own position, which is a single
 * element and wants to look like a device cursor rather than a piece of data.
 */

const STYLE = 'mapbox://styles/mapbox/dark-v11'

const ROUTE_SOURCE = 'routes'
const CHARGER_SOURCE = 'chargers'

interface Props {
  routes: RouteOption[]
  selectedId: string | null
  /** Tapping a line picks that route. Omit to make the lines inert. */
  onSelectRoute?: (id: string) => void
  chargers: ChargerOnRoute[]
  /** Tapping a charger dot opens its row. Omit to make the dots inert. */
  onSelectCharger?: (chargerId: string) => void
  /** The driver's own position, drawn as a device cursor. */
  position: LatLon | null
  /**
   * Require two fingers to pan, and show a hint when one finger is used.
   *
   * Non-negotiable for a map embedded in a scrolling page: a full-gesture map
   * swallows the drag that was meant to scroll to the chargers below it, and
   * the page simply stops scrolling under the driver's thumb. The full-screen
   * sheet owns the viewport, so it turns this off.
   */
  cooperativeGestures?: boolean
  /** Room to leave around the routes when framing them, in pixels. */
  padding?: number
  /**
   * Frame on this point instead of on the routes.
   *
   * The default framing fits the whole trip, which is the right answer when the
   * question is "which way do I go" and useless when it is "what is around this
   * charger" — at whole-trip zoom a station is a 3 px dot. The detail panel
   * passes its charger here.
   */
  focus?: LatLon | null
  /** Half-width of the box drawn around `focus`, in metres. */
  focusRadiusM?: number
  className?: string
}

export function RouteMap({
  routes,
  selectedId,
  onSelectRoute,
  chargers,
  onSelectCharger,
  position,
  cooperativeGestures = false,
  padding = 32,
  focus = null,
  focusRadiusM = 1_200,
  className,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const marker = useRef<mapboxgl.Marker | null>(null)
  /** Which set of routes the view was last framed to, so a re-pick does not re-frame. */
  const framed = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // Props the map is built with rather than updated from. Held in a ref so the
  // setup effect can stay a mount-once effect without lying about its
  // dependencies: a tap handler changes identity on every render, and tearing
  // the map down and rebuilding it for that would be a disaster.
  const handlers = useRef({ onSelectRoute, onSelectCharger })
  handlers.current = { onSelectRoute, onSelectCharger }

  const token = optionalToken()

  useEffect(() => {
    if (!container.current || !token) return

    let instance: mapboxgl.Map
    try {
      instance = new mapboxgl.Map({
        container: container.current,
        accessToken: token,
        style: STYLE,
        cooperativeGestures,
        // Replaced below by a compact one; leaving this on would add a second.
        attributionControl: false,
      })
    } catch {
      // No WebGL, or a context the browser refused to give us. The rows below
      // still answer the question, so fail visibly but harmlessly.
      setFailed(true)
      return
    }
    map.current = instance

    // Attribution is a condition of using the tiles, so it stays — but compact,
    // which is a single "i" rather than a line of text across a narrow phone.
    instance.addControl(new mapboxgl.AttributionControl({ compact: true }))

    if (!cooperativeGestures) {
      instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    }

    instance.on('load', () => {
      instance.addSource(ROUTE_SOURCE, { type: 'geojson', data: empty() })
      instance.addSource(CHARGER_SOURCE, { type: 'geojson', data: empty() })

      // A 3 px line is far below the ~44 px a fingertip actually covers, so the
      // tap target is its own invisible, much fatter layer.
      instance.addLayer({
        id: 'routes-hit',
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round' },
        paint: { 'line-width': 24, 'line-opacity': 0 },
      })
      // Two layers rather than one, so the chosen route is painted over the
      // alternatives it overlaps instead of relying on source order.
      instance.addLayer(lineLayer('routes-alternatives', false))
      instance.addLayer(lineLayer('routes-selected', true))

      instance.addLayer({
        id: 'chargers-dots',
        type: 'circle',
        source: CHARGER_SOURCE,
        paint: {
          // Scaled by zoom. At a fixed radius the dots along a 300 km route
          // overlap into one thick chain that hides the very line they are
          // strung along — the route stops being readable exactly when the
          // whole-trip view is what you are looking at.
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 9, 4, 13, 6],
          'circle-color': ['get', 'colour'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 1.5],
          'circle-stroke-color': '#0f172a',
        },
      })
      // A dot drawn at 3 px so it does not bury the route is a dot no thumb can
      // hit. Same answer as the route lines: the tap target is its own
      // invisible, much fatter layer.
      instance.addLayer({
        id: 'chargers-hit',
        type: 'circle',
        source: CHARGER_SOURCE,
        paint: { 'circle-radius': 14, 'circle-opacity': 0 },
      })

      setReady(true)
    })

    instance.on('click', 'routes-hit', (e) => {
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') handlers.current.onSelectRoute?.(id)
    })

    // A dot used to open a popup here. It now opens the charger's row instead:
    // one place to read a charger, rather than a cramped summary that had to be
    // built as an escaped HTML string outside React.
    instance.on('click', 'chargers-hit', (e) => {
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'string') handlers.current.onSelectCharger?.(id)
    })

    // Desktop affordance; harmless on touch.
    for (const layer of ['routes-hit', 'chargers-hit']) {
      instance.on('mouseenter', layer, () => {
        instance.getCanvas().style.cursor = 'pointer'
      })
      instance.on('mouseleave', layer, () => {
        instance.getCanvas().style.cursor = ''
      })
    }

    return () => {
      marker.current?.remove()
      marker.current = null
      instance.remove()
      map.current = null
      setReady(false)
    }
  }, [token, cooperativeGestures])

  // Routes, and the framing that goes with them.
  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return

    const collection = routeFeatures(routes, selectedId)
    source(instance, ROUTE_SOURCE)?.setData(collection)

    // A focused map is framed on its point and never on the trip; the two
    // framings would fight, and re-framing to the whole route the moment the
    // charger data refreshed would throw the view away mid-look.
    const key = focus ? `focus:${focus.lat},${focus.lon}` : framingKey(routes)
    if (framed.current === key) return

    if (focus) {
      framed.current = key
      const around = buffer(toPoint(focus), focusRadiusM, { units: 'meters' })
      if (!around) return
      const [west, south, east, north] = bbox(around)
      instance.fitBounds([west, south, east, north], { padding, duration: 0 })
      return
    }

    if (collection.features.length > 0) {
      framed.current = key
      const [west, south, east, north] = bbox(collection)
      instance.fitBounds([west, south, east, north], { padding, duration: 0 })
    }
  }, [ready, routes, selectedId, padding, focus, focusRadiusM])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    source(instance, CHARGER_SOURCE)?.setData(chargerFeatures(chargers))
  }, [ready, chargers])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    if (!position) {
      marker.current?.remove()
      marker.current = null
      return
    }
    if (!marker.current) {
      marker.current = new mapboxgl.Marker({ element: positionDot() })
    }
    marker.current.setLngLat([position.lon, position.lat]).addTo(instance)
  }, [ready, position])

  if (!token || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-900 px-6 text-center text-sm text-slate-500 ${className ?? ''}`}
      >
        {token
          ? 'This device could not open a map. The routes are listed below.'
          : 'Add a Mapbox token to see the route on a map.'}
      </div>
    )
  }

  return <div ref={container} className={className} />
}

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

const source = (map: mapboxgl.Map, id: string): mapboxgl.GeoJSONSource | undefined =>
  map.getSource(id) as mapboxgl.GeoJSONSource | undefined

const lineLayer = (id: string, selected: boolean): mapboxgl.LayerSpecification => ({
  id,
  type: 'line',
  source: ROUTE_SOURCE,
  filter: ['==', ['get', 'selected'], selected],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: {
    'line-color': ['get', 'colour'],
    'line-width': selected ? 5 : 3,
  },
})

/**
 * A device cursor, not a data point: filled dot, white ring, no animation. A
 * pulse would be one more thing repainting on a phone that is mounted in a
 * windscreen for nine hours.
 */
function positionDot(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600 shadow'
  el.setAttribute('aria-label', 'Your position')
  return el
}
