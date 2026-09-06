import { describe, expect, it } from 'vitest'
import type { Charger, ChargerOnRoute } from '../core/types'
import { chargerPopupHtml, escapeHtml } from './chargerPopup'

const charger = (overrides: Partial<Charger> = {}): Charger => ({
  id: 'enbw:1',
  providerId: 'enbw',
  name: 'EnBW Rosenheim',
  address: 'Innstraße 1, 83022 Rosenheim',
  lat: 47.85,
  lon: 12.12,
  totalPoints: 4,
  availablePoints: 2,
  unknownPoints: 0,
  maxPowerKw: 300,
  operator: 'EnBW',
  operatorCode: null,
  priceGroup: null,
  authMethods: [],
  alwaysOpen: true,
  ...overrides,
})

const onRoute = (overrides: Partial<ChargerOnRoute> = {}): ChargerOnRoute => ({
  charger: charger(),
  alongDistanceM: 42_000,
  alongDurationS: 1_800,
  offsetM: 300,
  detourS: 240,
  ...overrides,
})

describe('chargerPopupHtml', () => {
  it('leads with the station and the numbers the list shows', () => {
    const html = chargerPopupHtml(onRoute())
    expect(html).toContain('EnBW Rosenheim')
    expect(html).toContain('Innstraße 1, 83022 Rosenheim')
    expect(html).toContain('300 kW')
    expect(html).toContain('2/4 free')
    expect(html).toContain('42 km')
    expect(html).toContain('+4 min')
  })

  it('keeps "no live data" distinct from "none free"', () => {
    expect(chargerPopupHtml(onRoute({ charger: charger({ availablePoints: null }) }))).toContain(
      '? free',
    )
    expect(chargerPopupHtml(onRoute({ charger: charger({ availablePoints: 0 }) }))).toContain(
      '0/4 free',
    )
  })

  it('omits the address line rather than printing an empty one', () => {
    const html = chargerPopupHtml(onRoute({ charger: charger({ address: null }) }))
    expect(html).not.toContain('null')
    expect(html).toContain('EnBW Rosenheim')
  })

  it('escapes provider text, which is not ours and is not trusted', () => {
    const html = chargerPopupHtml(
      onRoute({
        charger: charger({
          name: '<img src=x onerror="alert(1)">',
          address: `Bad & "quoted" it's <b>here</b>`,
        }),
      }),
    )
    // The bar is that no tag can form: the words may survive as inert text,
    // but no '<' that opens one and no quote that closes an attribute does.
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('="alert(1)"')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&#39;')
  })
})

describe('escapeHtml', () => {
  it('escapes the ampersand before the entities it introduces', () => {
    // Naive sequential replacement yields "&amp;lt;" here.
    expect(escapeHtml('&<')).toBe('&amp;&lt;')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Ionity Nürnberg-Feucht')).toBe('Ionity Nürnberg-Feucht')
  })
})
