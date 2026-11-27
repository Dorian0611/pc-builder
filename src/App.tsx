import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, loadCatalog, withPart, withoutPart, type Catalog, type CategoryInfo } from './lib/catalog'
import { checkBuild } from './lib/compat'
import { fullName, specLine } from './lib/specs'
import type { BuildSelection, CatalogMeta, CheckLevel } from './lib/types'
import { PartPicker } from './components/PartPicker'
import { Summary } from './components/Summary'
import { Footer } from './components/Footer'
import { PriceInfo } from './components/PriceInfo'
import { Build3DPanel } from './components/Build3DPanel'
import { buildParts } from './lib/builder'
import { BuildActions } from './components/BuildActions'
import { UpgradeAdvisor } from './components/UpgradeAdvisor'
import { AutoBuilderModal } from './components/AutoBuilderModal'
import { withReplaced } from './lib/upgrade'
import { buildCodeFromHash, decodeBuild, encodeBuild } from './lib/share'

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

/** Üzenet a lap tetején: megosztott link vagy mentett összeállítás betöltése után. */
type Notice = { text: string; undoLabel?: string; previous?: BuildSelection }

const loadedText = (what: string, missing: number) =>
  what + (missing > 0 ? ` ${missing} alkatrésze már nincs az adatbázisban, ezek kimaradtak.` : '')

const isEmpty = (sel: BuildSelection) => !Object.values(sel).some((v) => v && v.length > 0)

/** Megnyitáskor: a link (#b=…) elsőbbséget kap a böngészőben tárolt összeállítással szemben. */
function initialState(catalog: Catalog): { selection: BuildSelection; notice: Notice | null } {
  const stored = loadSelection()
  const code = buildCodeFromHash(window.location.hash)
  if (code === null) return { selection: stored, notice: null }
  const { selection, missing } = decodeBuild(code, catalog.getPart)
  if (encodeBuild(stored) === encodeBuild(selection)) return { selection, notice: null }
  return {
    selection,
    notice: {
      text: loadedText('Megosztott összeállítást nyitottál meg.', missing),
      undoLabel: 'Vissza a saját összeállításomhoz',
      previous: isEmpty(stored) ? undefined : stored,
    },
  }
}

function Builder({ catalog, meta }: { catalog: Catalog; meta: CatalogMeta }) {
  const [initial] = useState(() => initialState(catalog))
  const [selection, setSelection] = useState<BuildSelection>(initial.selection)
  const [notice, setNotice] = useState<Notice | null>(initial.notice)
  const [picking, setPicking] = useState<CategoryInfo | null>(null)
  const [autoOpen, setAutoOpen] = useState(false)

  // tárolás a böngészőben + a címsorban mindig az aktuális összeállítás linkje
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
    const code = encodeBuild(selection)
    const url = new URL(window.location.href)
    url.hash = code ? `b=${code}` : ''
    if (url.href !== window.location.href) history.replaceState(null, '', url)
  }, [selection])

  // másik link beillesztése ugyanebbe a fülbe
  useEffect(() => {
    const onHash = () => {
      const code = buildCodeFromHash(window.location.hash)
      if (code === null || code === encodeBuild(selection)) return
      const { selection: next, missing } = decodeBuild(code, catalog.getPart)
      setNotice({
        text: loadedText('Megosztott összeállítást nyitottál meg.', missing),
        undoLabel: 'Vissza az előzőhöz',
        previous: isEmpty(selection) ? undefined : selection,
      })
      setSelection(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [catalog, selection])

  /** Összeállítás cseréje úgy, hogy az előző egy kattintással visszahozható. */
  const replaceSelection = (next: BuildSelection, text: string, undoLabel: string) => {
    setNotice({ text, undoLabel, previous: isEmpty(selection) ? undefined : selection })
    setSelection(next)
  }

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
        <div className="flex flex-wrap items-start gap-2">
          <button
            onClick={() => setAutoOpen(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Automatikus összeállítás
          </button>
          <BuildActions
            catalog={catalog}
            selection={selection}
            hasAny={hasAny}
            onNew={() => replaceSelection({}, 'Új összeállítást kezdtél.', 'Visszavonás')}
            onLoad={(sel, missing) =>
              replaceSelection(sel, loadedText('Mentett összeállítás betöltve.', missing), 'Vissza az előzőhöz')
            }
          />
        </div>
      </header>

      {autoOpen && (
        <AutoBuilderModal
          catalog={catalog}
          selection={selection}
          onClose={() => setAutoOpen(false)}
          onLoad={(sel, summary) => {
            replaceSelection(sel, `Automatikus összeállítás betöltve (${summary}).`, 'Vissza az előzőhöz')
            setAutoOpen(false)
          }}
        />
      )}

      {notice && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          <span className="flex-1">{notice.text}</span>
          {notice.previous && (
            <button
              onClick={() => {
                setSelection(notice.previous!)
                setNotice(null)
              }}
              className="font-medium underline"
            >
              {notice.undoLabel}
            </button>
          )}
          <button onClick={() => setNotice(null)} className="text-blue-700" aria-label="Üzenet bezárása">
            ✕
          </button>
        </div>
      )}

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
                        <PriceInfo part={p} />
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

        <div className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Build3DPanel build={build} levels={partLevel} parts={buildParts(build)} />
          <Summary build={build} checks={checks} />
        </div>
      </div>

      <UpgradeAdvisor
        catalog={catalog}
        selection={selection}
        onApply={(parts) =>
          replaceSelection(
            parts.reduce(withReplaced, selection),
            `Csere: ${parts.map(fullName).join(' + ')}.`,
            'Visszavonás',
          )
        }
      />

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
