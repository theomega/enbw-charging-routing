/**
 * The glyph in front of a suggestion row.
 *
 * Two signals, because neither is enough alone. `maki` is Mapbox's own icon
 * name and is the specific one — `lodging`, `restaurant`, `bus` — but it is
 * `marker` for a town, a street and a house number alike, so the
 * administrative kinds are separated by `feature_type` instead.
 */

export type PlaceIconKind = 'lodging' | 'food' | 'transport' | 'address' | 'town' | 'pin'

const LODGING = new Set(['lodging', 'campsite', 'shelter'])
const FOOD = new Set(['restaurant', 'fast-food', 'cafe', 'bar', 'bakery', 'ice-cream', 'beer'])
const TRANSPORT = new Set([
  'bus',
  'rail',
  'rail-metro',
  'rail-light',
  'airport',
  'ferry',
  'bicycle-share',
])
const TOWN_TYPES = new Set(['place', 'locality', 'district', 'region', 'country', 'neighborhood'])
const ADDRESS_TYPES = new Set(['address', 'street', 'block', 'postcode'])

export function placeIconKind(featureType: string, maki: string | null): PlaceIconKind {
  if (maki) {
    if (LODGING.has(maki)) return 'lodging'
    if (FOOD.has(maki)) return 'food'
    if (TRANSPORT.has(maki)) return 'transport'
  }
  if (TOWN_TYPES.has(featureType)) return 'town'
  if (ADDRESS_TYPES.has(featureType)) return 'address'
  return 'pin'
}

const paths: Record<PlaceIconKind, JSX.Element> = {
  lodging: (
    <>
      <path d="M2 4v16" />
      <path d="M2 8h18a2 2 0 0 1 2 2v10" />
      <path d="M2 17h20" />
      <path d="M6 8v9" />
    </>
  ),
  food: (
    <>
      <path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3" />
      <path d="M21 15v7" />
    </>
  ),
  transport: (
    <>
      <path d="M4 17V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11" />
      <path d="M4 11h16" />
      <path d="M8 4v7" />
      <path d="M16 4v7" />
      <path d="M6 17v2" />
      <path d="M18 17v2" />
      <path d="M4 17h16" />
    </>
  ),
  address: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  town: (
    <>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2" />
      <path d="M10 7h4" />
      <path d="M10 11h4" />
      <path d="M10 15h4" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
}

export function PlaceIcon({
  featureType,
  maki,
  className,
}: {
  featureType: string
  maki: string | null
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? 'h-5 w-5'}
    >
      {paths[placeIconKind(featureType, maki)]}
    </svg>
  )
}
