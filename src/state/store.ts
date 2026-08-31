import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderFilter } from '../providers/enbw'
import type { MapsApp } from '../nav/deepLinks'
import type { Place } from '../routing/mapbox'

export interface Settings {
  providerFilter: ProviderFilter
  minPowerKw: number
  mapsApp: MapsApp
  hideFullStations: boolean
  /** null = no cap. */
  maxDetourMinutes: number | null
}

export const DEFAULT_SETTINGS: Settings = {
  providerFilter: 'enbw',
  minPowerKw: 50,
  mapsApp: 'auto',
  hideFullStations: false,
  maxDetourMinutes: null,
}

const MAX_RECENTS = 10

export const PERSIST_VERSION = 3

/**
 * Migrate state written by an older build that may still be sitting in a
 * phone's localStorage.
 *
 * Exported (rather than inlined into the persist config) so it can be tested
 * directly: the persist middleware does not initialise in a Node test
 * environment, where there is no localStorage to read.
 */
export function migratePersisted(persisted: unknown, version: number): AppState {
  const state = (persisted ?? {}) as Partial<AppState>
  // Merging over the defaults means a setting added after this state was
  // written is populated rather than arriving as undefined.
  const settings = { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) }

  // v1 -> v2: 'enbw-operated' (operatorCode === 'DEEBW') and 'enbw-tariff'
  // (priceGroup === 'ENBW_GROUP') collapsed into a single, correct 'enbw'
  // filter. Without this remap a phone upgrading from v1 would hold a filter
  // value that no predicate matches, and show an empty list forever.
  if (version < 2) {
    const legacy = settings.providerFilter as string
    if (legacy === 'enbw-operated' || legacy === 'enbw-tariff') {
      settings.providerFilter = 'enbw'
    }
  }

  // v2 -> v3: the sort setting is gone. Chargers are always listed in the order
  // you drive past them, so a persisted 'sortBy' is now meaningless. Strip it
  // rather than let a dead key linger in localStorage.
  if (version < 3) {
    delete (settings as Record<string, unknown>).sortBy
  }

  return {
    ...state,
    settings,
    recentDestinations: state.recentDestinations ?? [],
    lastDestination: state.lastDestination ?? null,
  } as AppState
}

interface AppState {
  /** Restored on open, so reopening mid-trip picks up where you left off. */
  lastDestination: Place | null
  recentDestinations: Place[]
  settings: Settings
  setDestination: (place: Place | null) => void
  removeRecent: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  resetSettings: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lastDestination: null,
      recentDestinations: [],
      settings: DEFAULT_SETTINGS,

      setDestination: (place) =>
        set((state) => {
          if (!place) return { lastDestination: null }
          const recents = [
            place,
            ...state.recentDestinations.filter((p) => p.id !== place.id),
          ].slice(0, MAX_RECENTS)
          return { lastDestination: place, recentDestinations: recents }
        }),

      removeRecent: (id) =>
        set((state) => ({
          recentDestinations: state.recentDestinations.filter((p) => p.id !== id),
          lastDestination: state.lastDestination?.id === id ? null : state.lastDestination,
        })),

      updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'charging-routing/v1',
      version: PERSIST_VERSION,
      migrate: migratePersisted,
      partialize: (state) => ({
        lastDestination: state.lastDestination,
        recentDestinations: state.recentDestinations,
        settings: state.settings,
      }),
    },
  ),
)
