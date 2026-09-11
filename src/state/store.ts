import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChargerFilters } from '../core/filters'
import type { Place } from '../core/types'
import type { MapsApp } from '../nav/deepLinks'

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
 * What a phone starts with, and what it falls back to when the stored format is
 * no longer the current one.
 */
const INITIAL_PERSISTED = {
  lastDestination: null as Place | null,
  recentDestinations: [] as Place[],
  settings: DEFAULT_SETTINGS,
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
      ...INITIAL_PERSISTED,

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
      // Anything written under an older version is thrown away instead of
      // migrated. There is nothing here worth carrying across a format change:
      // the destination and the recents are a few taps to re-enter, and the
      // settings are three fields. Bump PERSIST_VERSION whenever the shape or
      // the meaning of a persisted field changes and every phone starts clean.
      migrate: () => INITIAL_PERSISTED,
      partialize: (state) => ({
        lastDestination: state.lastDestination,
        recentDestinations: state.recentDestinations,
        settings: state.settings,
      }),
    },
  ),
)
