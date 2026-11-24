import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, loadCatalog, withPart, withoutPart, type Catalog, type CategoryInfo } from './lib/catalog'
import { checkBuild } from './lib/compat'
import { fullName, specLine } from './lib/specs'
import type { BuildSelection, CatalogMeta, CheckLevel } from './lib/types'
import { PartPicker } from './components/PartPicker'
import { Summary } from './components/Summary'
import { Footer } from './components/Footer'
import { PriceInfo } from './components/PriceInfo'

const STORAGE_KEY = 'pc-builder:current'

function loadSelection(): BuildSelection {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

const DOT: Record<CheckLevel, string> = {
  error: 'bg-red-600',
  warning: 'bg-amber-500',
  unknown: 'bg-amber-300',
  ok: 'bg-emerald-600',
}

export default function App() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; catalog: Catalog; meta: CatalogMeta }
  >({ status: 'loading' })

  useEffect(() => {
    loadCatalog()
      .then(({ catalog, meta }) => setState({ status: 'ready', catalog, meta }))
      .catch((e: Error) => setState({ status: 'error', error: e.message }))
  }, [])

  if (state.status === 'loading')
    return <div className="p-10 text-center text-slate-500">Alkatrész-adatbázis betöltése…</div>
  if (state.status === 'error')
    return <div className="p-10 text-center text-red-700">Nem sikerült betölteni az adatokat: {state.error}</div>
  return <Builder catalog={state.catalog} meta={state.meta} />
}

function Builder({ catalog, meta }: { catalog: Catalog; meta: CatalogMeta }) {
  const [selection, setSelection] = useState<BuildSelection>(loadSelection)
  const [picking, setPicking] = useState<CategoryInfo | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
  }, [selection])

  const build = useMemo(() => catalog.resolveBuild(selection), [catalog, selection])
  const checks = useMemo(() => checkBuild(build), [build])

  /** alkatrészenként a legrosszabb ellenőrzési szint (sorok melletti pötty) */
  const partLevel = useMemo(() => {
    const order: CheckLevel[] = ['error', 'warning', 'unknown', 'ok']
    const m = new Map<string, CheckLevel>()
    for (const c of checks)
      for (const id of c.partIds) {
        const cur = m.get(id)
        if (!cur || order.indexOf(c.level) < order.indexOf(cur)) m.set(id, c.level)
      }
    return m
  }, [checks])

  const hasAny = Object.values(selection).some((v) => v && v.length > 0)
  const total = Object.values(meta.counts).reduce((s, n) => s + (n ?? 0), 0)
  const hasPrices = useMemo(
    () => Object.values(catalog.data).some((list) => (list as { price?: unknown }[]).some((p) => p.price)),
    [catalog],
  )

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">PC-összerakó</h1>
          <p className="text-slate-500">
            Válassz alkatrészeket {total.toLocaleString('hu-HU')} termékből – az oldal ellenőrzi, hogy összeillenek-e.
          </p>
        </div>
        {hasAny && (
          <button
            onClick={() => setSelection({})}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            Új összeállítás
          </button>
        )}
      </header>

      {!hasPrices && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Fejlesztői változat: az árak gyűjtése még nem indult el, ezért egyelőre nincsenek árak.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <main className="min-w-0 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {CATEGORIES.map((cat) => {
            const ids = selection[cat.id] ?? []
            return (
              <section key={cat.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-medium">
                    {cat.label}
                    {!cat.required && <span className="ml-2 text-sm font-normal text-slate-400">opcionális</span>}
                  </h2>
                  {(cat.multi || ids.length === 0) && (
                    <button
                      onClick={() => setPicking(cat)}
                      className="rounded-md border border-blue-600 px-3 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50"
                    >
                      {ids.length === 0 ? '+ Választás' : '+ Még egy'}
                    </button>
                  )}
                </div>

                {ids.map((id, i) => {
                  const p = catalog.getPart(id)
                  if (!p) return null
                  const lvl = partLevel.get(id)
                  return (
                    <div key={`${id}-${i}`} className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${lvl ? DOT[lvl] : 'bg-slate-300'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" title={fullName(p)}>{fullName(p)}</div>
                        <div className="truncate text-sm text-slate-500">{specLine(p)}</div>
                      </div>
                      <div className="shrink-0">
                        <PriceInfo price={p.price} />
                      </div>
                      {!cat.multi && (
                        <button onClick={() => setPicking(cat)} className="text-sm text-blue-700 hover:underline">
                          Csere
                        </button>
                      )}
                      <button
                        onClick={() => setSelection((s) => withoutPart(s, cat.id, i))}
                        className="rounded px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        aria-label={`${fullName(p)} eltávolítása`}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </main>

        <Summary build={build} checks={checks} />
      </div>

      <Footer meta={meta} />

      {picking && (
        <PartPicker
          catalog={catalog}
          category={picking}
          selection={picking.multi ? selection : { ...selection, [picking.id]: [] }}
          onClose={() => setPicking(null)}
          onPick={(p) => {
            setSelection((s) => withPart(s, p))
            setPicking(null)
          }}
        />
      )}
    </div>
  )
}
