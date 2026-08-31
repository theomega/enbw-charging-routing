import {
  PROVIDER_FILTERS,
  PROVIDER_FILTER_LABELS,
  type ProviderFilter,
} from '../providers/enbw'
import type { MapsApp } from '../nav/deepLinks'
import { useAppStore } from '../state/store'

const POWER_OPTIONS = [0, 22, 50, 150, 300]
const DETOUR_OPTIONS: (number | null)[] = [null, 5, 10, 20]

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updateSettings)
  const reset = useAppStore((s) => s.resetSettings)

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-800 p-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <button onClick={onClose} className="text-sm font-medium text-emerald-400">
          Done
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <Section
          title="Which stations"
          hint="“EnBW network” is EnBW's own hardware at EnBW's own tariff, including SMATRICS EnBW abroad. “Works with my EnBW card” adds the whole roaming network, which is much larger outside Germany."
        >
          <div className="space-y-1">
            {PROVIDER_FILTERS.map((f: ProviderFilter) => (
              <Radio
                key={f}
                label={PROVIDER_FILTER_LABELS[f]}
                checked={settings.providerFilter === f}
                onChange={() => update({ providerFilter: f })}
              />
            ))}
          </div>
        </Section>

        <Section title="Minimum power">
          <Chips
            options={POWER_OPTIONS.map((kw) => ({
              key: String(kw),
              label: kw === 0 ? 'Any' : `${kw} kW+`,
              active: settings.minPowerKw === kw,
              onSelect: () => update({ minPowerKw: kw }),
            }))}
          />
        </Section>

        <Section title="Maximum detour">
          <Chips
            options={DETOUR_OPTIONS.map((m) => ({
              key: String(m),
              label: m == null ? 'Any' : `${m} min`,
              active: settings.maxDetourMinutes === m,
              onSelect: () => update({ maxDetourMinutes: m }),
            }))}
          />
        </Section>

        <Section title="Navigation app">
          <Chips
            options={(
              [
                ['auto', 'Automatic'],
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

        <Section title="Other">
          <label className="flex items-center justify-between rounded-lg bg-slate-900 p-3">
            <span className="text-slate-200">Hide fully occupied stations</span>
            <input
              type="checkbox"
              checked={settings.hideFullStations}
              onChange={(e) => update({ hideFullStations: e.target.checked })}
              className="h-5 w-5 accent-emerald-500"
            />
          </label>
        </Section>

        <button
          onClick={reset}
          className="w-full rounded-lg bg-slate-900 p-3 text-sm text-slate-400 ring-1 ring-slate-800"
        >
          Reset to defaults
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

function Radio({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      onClick={onChange}
      className={`flex w-full items-center justify-between rounded-lg p-3 text-left ${
        checked ? 'bg-emerald-950 text-emerald-200 ring-1 ring-emerald-800' : 'bg-slate-900'
      }`}
    >
      <span>{label}</span>
      {checked && <span aria-hidden>✓</span>}
    </button>
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
