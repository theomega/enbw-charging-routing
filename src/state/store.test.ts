import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, PERSIST_VERSION, migratePersisted as migrate } from './store'

describe('persisted settings migration', () => {
  it('is wired to the current persist version', () => {
    expect(PERSIST_VERSION).toBe(3)
  })

  it('defaults to the EnBW network filter', () => {
    expect(DEFAULT_SETTINGS.providerFilter).toBe('enbw')
  })

  it('remaps the v1 filter values that no longer exist', () => {
    // Without this, a phone upgrading from v1 holds a value no predicate
    // matches and shows an empty list forever.
    for (const legacy of ['enbw-operated', 'enbw-tariff']) {
      const migrated = migrate({ settings: { ...DEFAULT_SETTINGS, providerFilter: legacy } }, 1)
      expect(migrated.settings.providerFilter).toBe('enbw')
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

  it('leaves still-valid v1 values alone', () => {
    const migrated = migrate(
      { settings: { ...DEFAULT_SETTINGS, providerFilter: 'card-usable' } },
      1,
    )
    expect(migrated.settings.providerFilter).toBe('card-usable')
  })

  it('fills in settings added after the stored version was written', () => {
    const migrated = migrate({ settings: { providerFilter: 'all' } }, 1)
    expect(migrated.settings.minPowerKw).toBe(DEFAULT_SETTINGS.minPowerKw)
    expect(migrated.settings.mapsApp).toBe(DEFAULT_SETTINGS.mapsApp)
    expect(migrated.settings.providerFilter).toBe('all')
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
