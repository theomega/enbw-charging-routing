import { describe, expect, it } from 'vitest'
import { placeIconKind } from './placeIcon'

describe('placeIconKind', () => {
  it('reads the specific kinds off maki', () => {
    expect(placeIconKind('poi', 'lodging')).toBe('lodging')
    expect(placeIconKind('poi', 'restaurant')).toBe('food')
    expect(placeIconKind('poi', 'bus')).toBe('transport')
  })

  it('separates towns from addresses by feature type', () => {
    // Both carry maki "marker", so maki alone cannot tell them apart.
    expect(placeIconKind('place', 'marker')).toBe('town')
    expect(placeIconKind('address', 'marker')).toBe('address')
    expect(placeIconKind('street', 'marker')).toBe('address')
  })

  it('falls back to a pin for a POI it has no glyph for', () => {
    expect(placeIconKind('poi', 'cemetery')).toBe('pin')
    expect(placeIconKind('poi', null)).toBe('pin')
  })
})
