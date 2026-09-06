import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, PERSIST_VERSION, migratePersisted as migrate } from './store'

describe('persisted settings migration', () => {
  it('is wired to the current persist version', () => {
    expect(PERSIST_VERSION).toBe(5)
  })

  it('strips the providerFilter setting removed in v4', () => {
    // The shipped station list contains only EnBW-tariff stations, so there is
    // nothing left to select between.
    for (const legacy of ['enbw', 'enbw-operated', 'card-usable']) {
      const migrated = migrate({ settings: { ...DEFAULT_SETTINGS, providerFilter: legacy } }, 1)
      expect('providerFilter' in migrated.settings).toBe(false)
    }
  })

  it('strips the sortBy setting removed in v3', () => {
    // Chargers are always listed in route order now; a persisted sort key is
    // meaningless and must not linger in localStorage.
    const migrated = migrate(
      { settings: { ...DEFAULT_SETTINGS, sortBy: 'detour' } },
      2,
    )
    expect('sortBy' in migrated.settings).toBe(false)
  })

  it('leaves still-valid settings alone', () => {
    const migrated = migrate({ settings: { ...DEFAULT_SETTINGS, minPowerKw: 150 } }, 1)
    expect(migrated.settings.minPowerKw).toBe(150)
  })

  it('lifts a stored minimum power below the list floor (v4 -> v5)', () => {
    // The shipped list starts at 50 kW, so "Any" and "22 kW+" are settings that
    // can no longer match anything extra.
    expect(migrate({ settings: { minPowerKw: 0 } }, 4).settings.minPowerKw).toBe(50)
    expect(migrate({ settings: { minPowerKw: 22 } }, 4).settings.minPowerKw).toBe(50)
  })

  it('leaves a stricter minimum alone', () => {
    expect(migrate({ settings: { minPowerKw: 300 } }, 4).settings.minPowerKw).toBe(300)
  })

  it('fills in settings added after the stored version was written', () => {
    const migrated = migrate({ settings: { minPowerKw: 150 } }, 1)
    expect(migrated.settings.minPowerKw).toBe(150)
    expect(migrated.settings.mapsApp).toBe(DEFAULT_SETTINGS.mapsApp)
  })

  it('survives completely empty or absent persisted state', () => {
    for (const input of [undefined, null, {}]) {
      const migrated = migrate(input, 1)
      expect(migrated.settings).toEqual(DEFAULT_SETTINGS)
      expect(migrated.recentDestinations).toEqual([])
      expect(migrated.lastDestination).toBeNull()
    }
  })
})
