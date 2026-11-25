import { CATEGORIES } from '../lib/catalog'
import { formatHuf, totalPrice } from '../lib/builder'
import { estimatePower, sortChecks, worstLevel } from '../lib/compat'
import type { CheckLevel, CheckResult, ResolvedBuild } from '../lib/types'

const STYLE: Record<CheckLevel, { dot: string; text: string; label: string }> = {
  error: { dot: 'bg-red-600', text: 'text-red-800', label: 'Nem működik' },
  warning: { dot: 'bg-amber-500', text: 'text-amber-800', label: 'Figyelmeztetés' },
  unknown: { dot: 'bg-amber-300', text: 'text-amber-800', label: 'Nem ellenőrizhető' },
  ok: { dot: 'bg-emerald-600', text: 'text-emerald-800', label: 'Rendben' },
}

interface Props {
  build: ResolvedBuild
  checks: CheckResult[]
}

export function Summary({ build, checks }: Props) {
  const { totalHuf, priced, estimated, missingPrice } = totalPrice(build)
  const counted = priced + estimated
  const power = estimatePower(build)
  const worst = worstLevel(checks)
  const missingRequired = CATEGORIES.filter((c) => {
    if (!c.required) return false
    const v = build[c.id]
    return Array.isArray(v) ? v.length === 0 : !v
  })
  const sorted = sortChecks(checks)
  const problems = sorted.filter((c) => c.level !== 'ok')
  const oks = sorted.filter((c) => c.level === 'ok')

  return (
    <aside className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="text-sm text-slate-500">Becsült végösszeg</div>
        <div className="text-3xl font-semibold tabular-nums">
          {counted > 0 ? `${estimated > 0 ? '≈ ' : ''}${formatHuf(totalHuf)}` : '–'}
        </div>
        {counted === 0 && <div className="mt-1 text-sm text-slate-500">A kiválasztott alkatrészeknek még nincs ára.</div>}
        {counted > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
            {priced > 0 && <li>{priced} alkatrész bolti áron</li>}
            {estimated > 0 && <li className="text-amber-700">{estimated} alkatrész becsült áron (lásd az alkatrészeknél)</li>}
            {missingPrice > 0 && <li>{missingPrice} alkatrésznek nincs ára – nem számoltuk bele</li>}
          </ul>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Becsült csúcsfogyasztás</dt>
          <dd className="text-right tabular-nums">{power.uncertain ? '~' : ''}{power.peakW} W</dd>
          <dt className="text-slate-500">Javasolt táp</dt>
          <dd className="text-right tabular-nums">≥ {power.recommendedW} W</dd>
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${checks.length ? STYLE[worst].dot : 'bg-slate-300'}`} />
          <h2 className="font-semibold">Kompatibilitás</h2>
          {checks.length > 0 && <span className={`ml-auto text-sm ${STYLE[worst].text}`}>{STYLE[worst].label}</span>}
        </div>

        {checks.length === 0 && <p className="text-sm text-slate-500">Válassz legalább két alkatrészt az ellenőrzéshez.</p>}

        <ul className="space-y-2 text-sm">
          {problems.map((c, i) => (
            <li key={`${c.rule}-${i}`} className="flex gap-2">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STYLE[c.level].dot}`} />
              <span className={STYLE[c.level].text}>{c.message}</span>
            </li>
          ))}
        </ul>

        {oks.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-emerald-800">{oks.length} ellenőrzés rendben</summary>
            <ul className="mt-2 space-y-1 text-slate-600">
              {oks.map((c, i) => (
                <li key={`${c.rule}-${i}`} className="flex gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                  {c.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {missingRequired.length > 0 && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-500">
            Még hiányzik: {missingRequired.map((c) => c.label.toLowerCase()).join(', ')}.
          </p>
        )}
      </section>
    </aside>
  )
}
