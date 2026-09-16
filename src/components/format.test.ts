import { describe, expect, it } from 'vitest'
import {
  asEstimate,
  distanceOrEstimate,
  formatDetour,
  formatDetourDistance,
  formatDistance,
  formatDuration,
  formatDurationDelta,
  formatPointStatus,
  formatPower,
} from './format'

describe('formatDistance', () => {
  it('rounds metres to the nearest 10 below 1 km', () => {
    expect(formatDistance(384)).toBe('380 m')
    expect(formatDistance(470)).toBe('470 m')
  })
  it('uses one decimal, and the German comma, between 1 and 10 km', () => {
    expect(formatDistance(4_320)).toBe('4,3 km')
    expect(formatDistance(4_500)).toBe('4,5 km')
  })
  it('drops the decimal above 10 km, so there is no comma to write', () => {
    expect(formatDistance(83_400)).toBe('83 km')
    expect(formatDistance(206_000)).toBe('206 km')
  })
  it('never rounds a measured distance down to zero', () => {
    // "0 m" has to keep meaning "the two journeys came out identical".
    expect(formatDistance(4)).toBe('4 m')
    expect(formatDistance(0)).toBe('0 m')
  })
  it('formats the magnitude, so a negative keeps its own branch', () => {
    // Every branch used to test the signed value, so any negative fell into the
    // first one: −12 400 printed as "-12400 m".
    expect(formatDistance(-4)).toBe('4 m')
    expect(formatDistance(-560)).toBe('560 m')
    expect(formatDistance(-4_320)).toBe('4,3 km')
    expect(formatDistance(-12_400)).toBe('12 km')
  })
})

describe('formatDuration', () => {
  it('shows plain minutes below an hour', () => {
    expect(formatDuration(1_800)).toBe('30 min')
    expect(formatDuration(45 * 60)).toBe('45 min')
  })
  it('shows hours and minutes above', () => {
    expect(formatDuration(5_400)).toBe('1 h 30 min')
    expect(formatDuration(132 * 60)).toBe('2 h 12 min')
  })
  it('drops the minutes on a whole hour, with no stray spacing', () => {
    // This branch shipped as `${h}h ` once, which no other branch matched.
    expect(formatDuration(7_200)).toBe('2 h')
    expect(formatDurationDelta(7_200)).toBe('+2 h')
  })
})

describe('formatDetour', () => {
  it('distinguishes unpriced from zero', () => {
    expect(formatDetour(null)).toBe('—')
    expect(formatDetour(0)).toBe('kein Umweg')
    expect(formatDetour(20)).toBe('kein Umweg') // rounds to 0 min
  })
  it('signs a real detour', () => {
    expect(formatDetour(180)).toBe('+3 min')
    expect(formatDetour(7 * 60)).toBe('+7 min')
  })
  it('names a negative detour rather than calling it no detour', () => {
    expect(formatDetour(-240)).toBe('4 min weniger')
    expect(formatDetour(-12 * 60)).toBe('12 min weniger')
    // Sub-minute is a rounded verdict, not a rounded number, so it still holds.
    expect(formatDetour(-20)).toBe('kein Umweg')
  })
})

describe('formatDetourDistance', () => {
  it('distinguishes unpriced from zero', () => {
    expect(formatDetourDistance(null)).toBe('nicht berechnet')
    expect(formatDetourDistance(0)).toBe('0 m extra')
  })
  it('carries the sign in the word, since formatDistance drops it', () => {
    expect(formatDetourDistance(2_400)).toBe('2,4 km extra')
    expect(formatDetourDistance(-560)).toBe('560 m weniger')
    expect(formatDetourDistance(-4)).toBe('4 m weniger')
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
    expect(formatDurationDelta(0)).toBe('schnellste')
    expect(formatDurationDelta(-60)).toBe('schnellste')
  })

  it('signs a real penalty and rolls over to hours', () => {
    expect(formatDurationDelta(22 * 60)).toBe('+22 min')
    expect(formatDurationDelta(90 * 60)).toBe('+1 h 30 min')
    expect(formatDurationDelta(120 * 60)).toBe('+2 h')
  })
})

describe('distanceOrEstimate', () => {
  it('prefers the measured road figure and leaves it unmarked', () => {
    expect(distanceOrEstimate(206_000, 4_000)).toBe('206 km')
  })

  it('marks the fallback, so an estimate is not read as a measurement', () => {
    expect(distanceOrEstimate(null, 4_500)).toBe('≈ 4,5 km')
    expect(distanceOrEstimate(undefined, 4_500)).toBe('≈ 4,5 km')
  })

  it('takes the measured figure even when there is no estimate to fall back on', () => {
    expect(distanceOrEstimate(206_000, null)).toBe('206 km')
  })

  it('says nothing rather than guessing when neither is available', () => {
    expect(distanceOrEstimate(null, null)).toBe('—')
  })
})

describe('asEstimate', () => {
  it('marks a figure that was never priced', () => {
    expect(asEstimate('284 km')).toBe('≈ 284 km')
  })
})

describe('formatPointStatus', () => {
  it("puts EnBW's vocabulary into words", () => {
    expect(formatPointStatus('AVAILABLE')).toBe('Frei')
    expect(formatPointStatus('OCCUPIED')).toBe('Belegt')
    expect(formatPointStatus('OUT_OF_SERVICE')).toBe('Außer Betrieb')
    expect(formatPointStatus('BLOCKED')).toBe('Blockiert')
  })

  it('leaves no state EnBW is known to emit on the English fallback', () => {
    // The fallback echoes the provider's own word, which is English, so every
    // observed state has to be in the map: "BLOCKED" read as "blocked" in the
    // German panel until it was added. Compare against what the fallback would
    // have produced, which is the failure this guards.
    const titleCased = (s: string) =>
      s
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^./, (c) => c.toUpperCase())
    for (const status of ['AVAILABLE', 'OCCUPIED', 'OUT_OF_SERVICE', 'BLOCKED']) {
      expect(formatPointStatus(status)).not.toBe(titleCased(status))
    }
  })

  it('title-cases a status it has never seen rather than dropping it', () => {
    // The vocabulary is undocumented and open-ended; a point in an unknown
    // state must still say something rather than vanish from the list.
    expect(formatPointStatus('RESERVED_BY_OTHER')).toBe('Reserved by other')
  })

  it('treats a missing status as unknown', () => {
    expect(formatPointStatus(null)).toBe('Unbekannt')
  })
})
