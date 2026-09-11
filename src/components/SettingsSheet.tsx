import type { MapsApp } from '../nav/deepLinks'
import { useAppStore } from '../state/store'

/**
 * No "Any" and no 22 kW: the shipped list starts at 50 kW, so those options
 * would claim to widen a search that cannot widen. See MIN_STATION_POWER_KW.
 */
const POWER_OPTIONS = [50, 150, 300]
const DETOUR_OPTIONS: (number | null)[] = [null, 5, 10, 20]

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updateSettings)
  const reset = useAppStore((s) => s.resetSettings)

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 p-4">
        <h1 className="text-lg font-semibold">Einstellungen</h1>
        <button onClick={onClose} className="text-sm font-medium text-emerald-400">
          Zurück
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <Section title="Ladeleistung ab">
          <Chips
            options={POWER_OPTIONS.map((kw) => ({
              key: String(kw),
              label: `${kw} kW+`,
              active: settings.minPowerKw === kw,
              onSelect: () => update({ minPowerKw: kw }),
            }))}
          />
        </Section>

        <Section title="Maximaler Umweg">
          <Chips
            options={DETOUR_OPTIONS.map((m) => ({
              key: String(m),
              label: m == null ? 'Beliebig' : `${m} min`,
              active: settings.maxDetourMinutes === m,
              onSelect: () => update({ maxDetourMinutes: m }),
            }))}
          />
        </Section>

        <Section title="Karten-App">
          <Chips
            options={(
              [
                ['auto', 'Automatisch'],
                ['apple', 'Apple Maps'],
                ['google', 'Google Maps'],
              ] as [MapsApp, string][]
            ).map(([key, label]) => ({
              key,
              label,
              active: settings.mapsApp === key,
              onSelect: () => update({ mapsApp: key }),
            }))}
          />
        </Section>

        <button
          onClick={reset}
          className="w-full rounded-lg bg-slate-900 p-3 text-sm text-slate-400 ring-1 ring-slate-800"
        >
          Standardeinstellungen wiederherstellen
        </button>
      </div>
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="pb-2 text-xs uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
      {hint && <p className="pt-2 text-xs text-slate-600">{hint}</p>}
    </section>
  )
}

interface ChipOption {
  key: string
  label: string
  active: boolean
  onSelect: () => void
}

function Chips({ options }: { options: ChipOption[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={o.onSelect}
          className={`rounded-full px-4 py-2 text-sm ${
            o.active
              ? 'bg-emerald-600 font-medium text-white'
              : 'bg-slate-900 text-slate-300 ring-1 ring-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
