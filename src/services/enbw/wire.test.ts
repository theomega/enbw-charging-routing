import { describe, expect, it } from 'vitest'
import { ENBW_PRICE_GROUP, chargerId, stationIdOf } from './wire'

describe('charger ids', () => {
  it('namespaces the provider so a second source could never collide', () => {
    expect(chargerId(1955461)).toBe('enbw:1955461')
  })

  it('round-trips back to the station id the API speaks', () => {
    expect(stationIdOf(chargerId(1955461))).toBe(1955461)
  })
})

describe('ENBW_PRICE_GROUP', () => {
  /**
   * Not `operatorCode === 'DEEBW'`: EnBW runs abroad as SMATRICS EnBW (ITSMA,
   * ATSMA) and has German subsidiaries (DEODR, DESMA), all on this tariff.
   * Measured over 801 stations, the operator code matched 74 and the price
   * group 79 — filtering on the code made the app useless outside Germany.
   */
  it('is the tariff the offline list is built against', () => {
    expect(ENBW_PRICE_GROUP).toBe('ENBW_GROUP')
  })
})
