import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MapsApp } from '../nav/deepLinks'
import type { ChargerFilters } from '../core/filters'
import type { Place } from '../core/types'
import { MIN_STATION_POWER_KW } from '../services/enbw/stations'

/**
 * Everything the user can change. The filtering half is `ChargerFilters`, which
 * core/filters.ts defines and consumes — so the pure code never has to import
 * the store to know what a filter is.
 */
export interface Settings extends ChargerFilters {
  mapsApp: MapsApp
}

export const DEFAULT_SETTINGS: Settings = {
  minPowerKw: 50,
  mapsApp: 'auto',
  maxDetourMinutes: null,
}

const MAX_RECENTS = 10

export const PERSIST_VERSION = 5

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

  // v2 -> v3: the sort setting is gone. Chargers are always listed in the order
  // you drive past them, so a persisted 'sortBy' is now meaningless.
  if (version < 3) {
    delete (settings as Record<string, unknown>).sortBy
  }

  // v3 -> v4: the provider filter is gone. The station list shipped with the app
  // contains only EnBW-tariff stations, so there is nothing left to select
  // between. Strip the key rather than let it linger in localStorage.
  // (v1 -> v2 previously remapped 'enbw-operated'/'enbw-tariff' onto 'enbw';
  // that remap is now moot, since the setting itself no longer exists.)
  if (version < 4) {
    delete (settings as Record<string, unknown>).providerFilter
  }

  // v4 -> v5: the shipped list is built to a 50 kW floor, so a stored minimum
  // below it is a filter that can never match anything extra. Lift it rather
  // than leave a phone showing "Any" against a list that is not.
  if (settings.minPowerKw < MIN_STATION_POWER_KW) {
    settings.minPowerKw = MIN_STATION_POWER_KW
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
