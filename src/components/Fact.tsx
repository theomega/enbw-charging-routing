/**
 * One labelled figure in a stat grid: a label, the number, and an optional
 * line of context under it.
 *
 * Renders `<dt>`/`<dd>`, so **it must be placed inside a `<dl>`** — the grid
 * itself is the list. Anywhere else the markup is invalid and the label loses
 * the association with its value that a screen reader reads out. Both call
 * sites make their `<dl>` the grid container, which is what keeps the cells
 * laying out as siblings.
 *
 * The `<dl>` also carries the text size, so the panel and the list card can
 * scale their grids independently without this component knowing.
 */
export function Fact({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string
  value: string
  sub?: string
  emphasis?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`font-semibold ${emphasis ? 'text-emerald-300' : 'text-slate-100'}`}>
        {value}
      </dd>
      {sub && <dd className="text-xs text-slate-500">{sub}</dd>}
    </div>
  )
}
