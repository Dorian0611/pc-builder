import { useDeferredValue, useMemo, useState } from 'react'
import { formatHuf } from '../lib/builder'
import type { Catalog } from '../lib/catalog'
import { fullName, specLine } from '../lib/specs'
import { adviseUpgrades, CPU_CAP, type Limiter, type Suggestion } from '../lib/upgrade'
import type { BuildSelection, Part } from '../lib/types'

interface Props {
  catalog: Catalog
  selection: BuildSelection
  onApply: (part: Part) => void
}

const LIMITER_TEXT: Record<Limiter, string> = {
  cpu: 'A processzor fogja vissza a videókártyát: erősebb processzorral több FPS jönne ki a gépből.',
  gpu: 'A videókártya a szűk keresztmetszet – a processzor egy erősebb kártyát is kiszolgálna.',
  balanced: 'A processzor és a videókártya jól illik egymáshoz.',
}

const pct = (g: number) => `+${Math.round(g * 100)}%`

function Row({ s, onApply }: { s: Suggestion; onApply: (p: Part) => void }) {
  const estimated = !s.part.price
  return (
    <li className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={fullName(s.part)}>{fullName(s.part)}</div>
        <div className="truncate text-xs text-slate-500">{specLine(s.part)}</div>
        {s.needsPsu && <div className="text-xs text-amber-700">Erősebb táp is kell hozzá.</div>}
      </div>
      {s.gain !== null && (
        <div className="shrink-0 text-right text-sm font-semibold text-emerald-700" title="becsült teljesítménynövekedés játékban">
          {pct(s.gain)}
        </div>
      )}
      <div className={`w-28 shrink-0 text-right text-sm tabular-nums ${estimated ? 'text-amber-800' : ''}`}>
        {estimated ? 'kb. ' : ''}
        {formatHuf(s.priceHuf)}
      </div>
      <button onClick={() => onApply(s.part)} className="shrink-0 rounded-md border border-blue-600 px-2.5 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50">
        Csere
      </button>
    </li>
  )
}

/** „Mit érdemes fejleszteni?” – a mostani összeállításból kiindulva. */
export function UpgradeAdvisor({ catalog, selection, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [budget, setBudget] = useState('')
  const budgetHuf = Number(budget.replace(/\D/g, '')) || undefined
  // a sok jelölt végigellenőrzése ne akassza meg a gépelést / kattintást
  const deferredSel = useDeferredValue(selection)
  const deferredBudget = useDeferredValue(budgetHuf)
  const advice = useMemo(
    () => (open ? adviseUpgrades(catalog, deferredSel, deferredBudget) : null),
    [open, catalog, deferredSel, deferredBudget],
  )
  const bal = advice?.balance
  const hasBase = !!selection.cpu?.length || !!selection.gpu?.length

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div>
          <h2 className="font-semibold">Mit érdemes fejleszteni?</h2>
          <p className="text-sm text-slate-500">
            Rakd össze a mostani gépedet (vagy nyisd meg a linkjét), és megmutatjuk, melyik csere hozza a legtöbbet.
          </p>
        </div>
        <span className="ml-4 text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 px-5 py-4 text-sm">
          {!hasBase && <p className="text-slate-500">Válassz legalább egy processzort vagy videókártyát.</p>}

          {hasBase && bal && (
            <>
              <div className="flex flex-wrap items-end gap-4">
                <dl className="flex gap-6">
                  <div>
                    <dt className="text-xs text-slate-500">Processzor</dt>
                    <dd className="text-lg font-semibold tabular-nums">{bal.cpu ?? '–'} <span className="text-xs font-normal text-slate-500">pont</span></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Videókártya</dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {bal.gpu ?? '–'} <span className="text-xs font-normal text-slate-500">{selection.gpu?.length ? 'pont' : 'pont (integrált)'}</span>
                    </dd>
                  </div>
                </dl>
                <label className="ml-auto flex items-center gap-2">
                  <span className="text-slate-600">Keret:</span>
                  <input
                    inputMode="numeric"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="nincs megadva"
                    className="w-32 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                  />
                  <span className="text-slate-600">Ft</span>
                </label>
              </div>
              {bal.limiter && <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-900">{LIMITER_TEXT[bal.limiter]}</p>}
              {!!selection.gpu?.length && bal.gpu === undefined && (
                <p className="text-slate-500">Ehhez a (munkaállomás-) videókártyához nincs játékteljesítmény-becslésünk.</p>
              )}
            </>
          )}

          {advice && hasBase && (
            <>
              <Group
                title={selection.gpu?.length ? 'Videókártya-csere' : 'Videókártya hozzáadása'}
                list={advice.gpu}
                empty={
                  bal?.limiter === 'cpu'
                    ? 'Ezzel a processzorral egy gyorsabb videókártya most nem hozna többet – előbb a processzort érdemes cserélni.'
                    : budgetHuf
                      ? 'Ebből a keretből nincs érdemben gyorsabb videókártya.'
                      : 'Nincs érdemben gyorsabb videókártya, aminek ára is van az adatbázisban.'
                }
                onApply={onApply}
              />
              {bal?.cpu !== undefined && advice.gpu.some((s) => s.score >= CPU_CAP * bal.cpu!) && (
                <p className="-mt-3 text-xs text-slate-500">
                  Ennél erősebb kártyát ez a processzor már visszafogna – nagyobb ugráshoz a processzort is cserélni kellene.
                </p>
              )}
              {selection.cpu?.length ? (
                <Group
                  title="Processzorcsere (ugyanebbe az alaplapba)"
                  list={advice.cpu}
                  empty={
                    !advice.fasterCpuFits
                      ? 'Ebbe az alaplapba nincs érdemben gyorsabb processzor – nagyobb ugráshoz platformváltás (processzor + alaplap, esetleg memória) kellene.'
                      : budgetHuf && bal?.limiter === 'cpu'
                        ? 'Ebből a keretből nincs érdemben gyorsabb processzor ehhez az alaplaphoz.'
                        : 'A processzor cseréje ezzel a videókártyával most nem hozna érezhető javulást.'
                  }
                  onApply={onApply}
                />
              ) : null}
              {advice.other.length > 0 && (
                <div>
                  <h3 className="mb-2 font-medium">Egyéb javaslatok</h3>
                  <ul className="space-y-3">
                    {advice.other.map((o) => (
                      <li key={o.suggestion.part.id}>
                        <p className="mb-1 text-slate-700">{o.reason}</p>
                        <ul>
                          <Row s={o.suggestion} onApply={onApply} />
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <p className="text-xs text-slate-400">
            A pontszámok saját becslések a tipikus játékteljesítményre (processzor: Ryzen 5 7600 = 100, videókártya: RTX 4060 =
            100); a valódi FPS játékonként és felbontásonként eltér. A „+%” a processzor és a videókártya együttes korlátjából
            számolt becsült javulás. Csak olyan alkatrészt ajánlunk, ami a többihez illik és van (becsült) ára.
          </p>
        </div>
      )}
    </section>
  )
}

function Group({ title, list, empty, onApply }: { title: string; list: Suggestion[]; empty: string; onApply: (p: Part) => void }) {
  return (
    <div>
      <h3 className="mb-2 font-medium">{title}</h3>
      {list.length === 0 ? (
        <p className="text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <Row key={s.part.id} s={s} onApply={onApply} />
          ))}
        </ul>
      )}
    </div>
  )
}
