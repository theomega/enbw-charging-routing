import { describe, expect, it } from 'vitest'
import {
  formatDetour,
  formatDistance,
  formatDuration,
  formatDurationDelta,
  formatPower,
} from './format'

describe('formatDistance', () => {
  it('rounds metres to the nearest 10 below 1 km', () => {
    expect(formatDistance(384)).toBe('380 m')
  })
  it('uses one decimal between 1 and 10 km', () => {
    expect(formatDistance(4_320)).toBe('4.3 km')
  })
  it('drops the decimal above 10 km', () => {
    expect(formatDistance(83_400)).toBe('83 km')
  })
})

describe('formatDuration', () => {
  it('shows plain minutes below an hour', () => {
    expect(formatDuration(1_800)).toBe('30 min')
  })
  it('shows hours and minutes above', () => {
    expect(formatDuration(5_400)).toBe('1 h 30')
    expect(formatDuration(7_200)).toBe('2 h')
  })
})

describe('formatDetour', () => {
  it('distinguishes unpriced from zero', () => {
    expect(formatDetour(null)).toBe('—')
    expect(formatDetour(0)).toBe('on route')
    expect(formatDetour(20)).toBe('on route') // rounds to 0 min
  })
  it('signs a real detour', () => {
    expect(formatDetour(180)).toBe('+3 min')
  })
})

describe('formatPower', () => {
  it('marks unknown power rather than guessing', () => {
    expect(formatPower(null)).toBe('? kW')
    expect(formatPower(299.9)).toBe('300 kW')
  })
})

describe('formatDurationDelta', () => {
  it('labels the fastest route rather than showing +0 min', () => {
    expect(formatDurationDelta(0)).toBe('fastest')
    expect(formatDurationDelta(-60)).toBe('fastest')
  })

  it('signs a real penalty and rolls over to hours', () => {
    expect(formatDurationDelta(22 * 60)).toBe('+22 min')
    expect(formatDurationDelta(90 * 60)).toBe('+1 h 30')
    expect(formatDurationDelta(120 * 60)).toBe('+2 h')
  })
})
