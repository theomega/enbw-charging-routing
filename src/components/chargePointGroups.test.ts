import { describe, expect, it } from 'vitest'
import type { ChargePoint } from '../core/types'
import { describeGroup, groupChargePoints } from './chargePointGroups'

const point = (over: Partial<ChargePoint> = {}): ChargePoint => ({
  id: null,
  plugs: ['CCS (Typ 2)'],
  maxPowerKw: 300,
  status: 'AVAILABLE',
  ...over,
})

describe('groupChargePoints', () => {
  it('collapses points that say the same thing', () => {
    const groups = groupChargePoints([point(), point(), point()])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(groups[0].free).toBe(3)
  })

  it('keeps a different speed or a different connector apart', () => {
    const groups = groupChargePoints([
      point({ maxPowerKw: 300 }),
      point({ maxPowerKw: 150 }),
      point({ maxPowerKw: 150, plugs: ['Typ 2'] }),
    ])
    expect(groups).toHaveLength(3)
  })

  it('reads the same stall listed in either connector order as one group', () => {
    const groups = groupChargePoints([
      point({ plugs: ['CCS (Typ 2)', 'CHAdeMO'] }),
      point({ plugs: ['CHAdeMO', 'CCS (Typ 2)'] }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
    // Displayed in the order the provider gave for the first one seen.
    expect(groups[0].plugs).toEqual(['CCS (Typ 2)', 'CHAdeMO'])
  })

  it('puts the fastest first and an unknown power last', () => {
    const groups = groupChargePoints([
      point({ maxPowerKw: null }),
      point({ maxPowerKw: 22 }),
      point({ maxPowerKw: 300 }),
      point({ maxPowerKw: 150 }),
    ])
    expect(groups.map((g) => g.maxPowerKw)).toEqual([300, 150, 22, null])
  })

  it('orders same-speed groups by connector so a refresh does not reshuffle', () => {
    const groups = groupChargePoints([
      point({ plugs: ['Typ 2'] }),
      point({ plugs: ['CCS (Typ 2)'] }),
      point({ plugs: ['CHAdeMO'] }),
    ])
    expect(groups.map((g) => g.plugs[0])).toEqual(['CCS (Typ 2)', 'CHAdeMO', 'Typ 2'])
  })

  it('distinguishes nothing reported from nothing free', () => {
    const unreported = groupChargePoints([point({ status: null }), point({ status: null })])
    expect(unreported[0].free).toBeNull()

    const allBusy = groupChargePoints([
      point({ status: 'OCCUPIED' }),
      point({ status: 'OCCUPIED' }),
    ])
    expect(allBusy[0].free).toBe(0)
  })

  it('counts an unreported point among the rest so the breakdown still adds up', () => {
    const [group] = groupChargePoints([
      point({ status: 'AVAILABLE' }),
      point({ status: 'OCCUPIED' }),
      point({ status: null }),
      point({ status: 'UNKNOWN' }),
    ])
    expect(group.free).toBe(1)
    // Null and the provider's own UNKNOWN are the same word on screen.
    expect(group.others).toEqual([
      { status: 'UNKNOWN', count: 2 },
      { status: 'OCCUPIED', count: 1 },
    ])
    expect(group.free! + group.others.reduce((n, o) => n + o.count, 0)).toBe(group.count)
  })

  it('carries a status it has never seen through rather than dropping it', () => {
    const [group] = groupChargePoints([point({ status: 'RESERVED' })])
    expect(group.others).toEqual([{ status: 'RESERVED', count: 1 }])
  })

  it('has nothing to group when the station has no points', () => {
    expect(groupChargePoints([])).toEqual([])
  })
})

describe('describeGroup', () => {
  const describe1 = (points: ChargePoint[]) => describeGroup(groupChargePoints(points)[0])

  it('leads with the free count and names only the states that occur', () => {
    expect(describe1([point(), point(), point()])).toBe('3 points · 3 of 3 free')
    expect(describe1([point(), point({ status: 'OCCUPIED' })])).toBe(
      '2 points · 1 of 2 free · 1 in use',
    )
    expect(describe1([point(), point({ status: 'OUT_OF_SERVICE' })])).toBe(
      '2 points · 1 of 2 free · 1 out of service',
    )
  })

  it('says unknown rather than claiming none are free', () => {
    expect(describe1([point({ status: null }), point({ status: null })])).toBe(
      '2 points · status unknown',
    )
    expect(describe1([point({ status: 'OCCUPIED' })])).toBe('1 point · 0 of 1 free · 1 in use')
  })

  it('counts one point in the singular', () => {
    expect(describe1([point()])).toBe('1 point · 1 of 1 free')
  })

  it('lower-cases a state it has never seen instead of shouting it', () => {
    expect(describe1([point(), point({ status: 'RESERVED' })])).toBe(
      '2 points · 1 of 2 free · 1 reserved',
    )
  })
})
