import { describe, expect, it } from 'vitest'
import { ALTERNATIVE_STROKES, SELECTED_STROKE, strokeColours } from './routeColours'

describe('strokeColours', () => {
  it('paints the chosen route emerald wherever it sits in the list', () => {
    expect(strokeColours([{ selected: false }, { selected: true }])).toEqual([
      ALTERNATIVE_STROKES[0],
      SELECTED_STROKE,
    ])
  })

  it('gives each alternative its own colour, so a legend can name them', () => {
    const colours = strokeColours([
      { selected: true },
      { selected: false },
      { selected: false },
    ])
    expect(colours[1]).not.toBe(colours[2])
    expect(new Set(colours).size).toBe(3)
  })

  it('cycles rather than running out on an unexpected fourth route', () => {
    expect(
      strokeColours([
        { selected: true },
        { selected: false },
        { selected: false },
        { selected: false },
      ]),
    ).toEqual([
      SELECTED_STROKE,
      ALTERNATIVE_STROKES[0],
      ALTERNATIVE_STROKES[1],
      ALTERNATIVE_STROKES[0],
    ])
  })

  it('has no colour serving two purposes', () => {
    expect(ALTERNATIVE_STROKES).not.toContain(SELECTED_STROKE)
    expect(new Set(ALTERNATIVE_STROKES).size).toBe(ALTERNATIVE_STROKES.length)
  })

  it('is stable for a single route', () => {
    expect(strokeColours([{ selected: true }])).toEqual([SELECTED_STROKE])
  })
})
