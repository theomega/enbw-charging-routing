import { describe, expect, it } from 'vitest'
import {
  BADGE_TONE,
  DOT_COLOUR,
  TEXT_TONE,
  availabilityState,
  type AvailabilityState,
} from './availability'

const STATES: AvailabilityState[] = ['unknown', 'none', 'low', 'free']

describe('availabilityState', () => {
  it('keeps "no live data" apart from "none free"', () => {
    expect(availabilityState(null)).toBe('unknown')
    expect(availabilityState(0)).toBe('none')
  })

  it('calls a single free Ladesäule its own state, not plain "free"', () => {
    expect(availabilityState(1)).toBe('low')
    expect(availabilityState(2)).toBe('free')
  })

  it('stays "free" however many are open', () => {
    expect(availabilityState(47)).toBe('free')
  })
})

describe('the palettes', () => {
  it('answers for every state, so no surface falls through to undefined', () => {
    for (const state of STATES) {
      expect(DOT_COLOUR[state]).toBeTruthy()
      expect(BADGE_TONE[state]).toBeTruthy()
      expect(TEXT_TONE[state]).toBeTruthy()
    }
  })

  it('has no colour serving two states, in any medium', () => {
    for (const palette of [DOT_COLOUR, BADGE_TONE, TEXT_TONE]) {
      expect(new Set(Object.values(palette)).size).toBe(STATES.length)
    }
  })

  it('agrees on the hue for a state across map, badge and detail line', () => {
    // The shades differ by ground — saturated on the light basemap, dark under
    // a light number on the panel — but a state that reads red in one place may
    // never read amber in another.
    const hues: Record<AvailabilityState, string> = {
      unknown: 'slate',
      none: 'rose',
      low: 'amber',
      free: 'emerald',
    }
    for (const state of STATES) {
      expect(BADGE_TONE[state]).toContain(hues[state])
      expect(TEXT_TONE[state]).toContain(hues[state])
    }
  })
})
