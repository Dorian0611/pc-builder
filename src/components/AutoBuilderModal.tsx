import { useEffect, useState } from 'react'
import { autoBuild, MIN_BUDGET, PROFILES, type AutoBuildResult, type PlatformPref, type Profile } from '../lib/autobuilder'
import { formatHuf } from '../lib/builder'
import type { Catalog } from '../lib/catalog'
import { fullName, specLine } from '../lib/specs'
import type { BuildSelection } from '../lib/types'

interface Props {
  catalog: Catalog
  selection: BuildSelection
  onClose: () => void
  onLoad: (sel: BuildSelection, summary: string) => void
}

const QUICK = [250_000, 350_000, 500_000, 750_000, 1_000_000]

const PROFILE_TEXT: Record<Profile, { title: string; hint: string }> = {
  'gaming-1080p': { title: '1080p gaming / e-sport', hint: 'magas FPS, processzor és videókártya egyensúlyban' },
  'gaming-1440p': { title: '1440p / 4K gaming', hint: 'a pénz nagyobb része a videókártyára megy' },
  workstation: { title: 'Videóvágás / 3D / munka', hint: 'sokmagos processzor, legalább 32 GB, NVIDIA kártya (CUDA / NVENC)' },
  office: { title: 'Irodai / általános', hint: 'integrált grafika, csendes, keveset fogyaszt' },
}

const PLATFORMS: { id: PlatformPref; label: string }[] = [
  { id: 'any', label: 'Mindegy' },
  { id: 'am5', label: 'AMD AM5' },
  { id: 'am4', label: 'AMD AM4' },
  { id: 'intel', label: 'Intel' },
]

/** „Automatikus összeállítás” – keretből és felhasználási célból kész, kompatibilis gép. */
export function AutoBuilderModal({ catalog, selection, onClose, onLoad }: Props) {
  const [budget, setBudget] = useState('500000')
  const [noBudget, setNoBudget] = useState(false)
  const [profile, setProfile] = useState<Profile>('gaming-1080p')
  const [allowEstimates, setAllowEstimates] = useState(false)
  const [platform, setPlatform] = useState<PlatformPref>('any')
  const hasAny = Object.values(selection).some((v) => v && v.length > 0)
  const [keep, setKeep] = useState(false)
  const [result, setResult] = useState<AutoBuildResult | null>(null)

  const budgetHuf = Number(budget.replace(/\D/g, '')) || 0
  // a changed input makes the old result stale
  useEffect(() => setResult(null), [budgetHuf, noBudget, profile, allowEstimates, platform, keep])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = () =>
    setResult(
      autoBuild(catalog, { budgetHuf: noBudget ? undefined : budgetHuf, profile, allowEstimates, platform, keep: keep ? selection : undefined }),
    )

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-2 sm:p-6" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">Automatikus gépösszeállító</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Bezárás">
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-4 text-sm">
          {/* ---- keret */}
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label className="font-medium" htmlFor="ab-budget">
                Költségkeret
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                <input type="checkbox" checked={noBudget} onChange={(e) => setNoBudget(e.target.checked)} />
                Nincs keret – a legjobb gép, ami még megéri az árát
              </label>
            </div>
            <div className={`flex flex-wrap items-center gap-2 ${noBudget ? 'opacity-40' : ''}`}>
              <input
                id="ab-budget"
                inputMode="numeric"
                value={budget}
                disabled={noBudget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-36 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
              />
              <span className="text-slate-600">Ft</span>
              {QUICK.map((q) => (
                <button
                  key={q}
                  disabled={noBudget}
                  onClick={() => setBudget(String(q))}
                  className={`rounded-full border px-3 py-0.5 tabular-nums ${budgetHuf === q ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 hover:bg-slate-50'}`}
                >
                  {formatHuf(q)}
                </button>
              ))}
            </div>
            {!noBudget && budgetHuf > 0 && budgetHuf < MIN_BUDGET && (
              <p className="mt-1 text-amber-700">{formatHuf(MIN_BUDGET)} alatt új alkatrészekből nem állítható össze teljes gép.</p>
            )}
          </div>

          {/* ---- cél */}
          <div>
            <div className="mb-1 font-medium">Felhasználási cél</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(PROFILES) as Profile[]).map((p) => (
                <label
                  key={p}
                  className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 ${profile === p ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <input type="radio" name="ab-profile" checked={profile === p} onChange={() => setProfile(p)} className="mt-1" />
                  <span>
                    <span className="block font-medium">{PROFILE_TEXT[p].title}</span>
                    <span className="text-xs text-slate-500">{PROFILE_TEXT[p].hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* ---- haladó */}
          <details className="rounded-lg border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer font-medium">Haladó beállítások</summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={allowEstimates} onChange={(e) => setAllowEstimates(e.target.checked)} className="mt-1" />
                <span>
                  Becsült árú alkatrészek engedélyezése
                  <span className="block text-xs text-slate-500">
                    Alapból csak valós magyar bolti árral rendelkező alkatrészekből dolgozik; bekapcsolva a külföldi árakból és hasonló
                    termékekből becsült árúakat is használja.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2">
                <span>Platform:</span>
                <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformPref)} className="rounded border border-slate-300 bg-white px-2 py-1">
                  {PLATFORMS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              {hasAny && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="mt-1" />
                  <span>
                    Aktuális alkatrészek megtartása és a maradék keret elosztása
                    <span className="block text-xs text-slate-500">
                      A már kiválasztott alkatrészek maradnak, csak az üres helyeket tölti ki; az áruk beleszámít a keretbe.
                    </span>
                  </span>
                </label>
              )}
            </div>
          </details>

          <div className="flex justify-end">
            <button onClick={run} disabled={!noBudget && budgetHuf <= 0} className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-40">
              Összeállítás
            </button>
          </div>

          {/* ---- eredmény */}
          {result && !result.ok && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{result.reason}</p>}
          {result?.ok && (
            <div className="rounded-lg border border-slate-200">
              <ul className="divide-y divide-slate-100">
                {result.parts.map((p) => {
                  const kept = keep && (selection[p.category] ?? []).includes(p.id)
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" title={fullName(p)}>
                          {fullName(p)}
                          {kept && <span className="ml-2 text-xs font-normal text-slate-500">(megtartva)</span>}
                        </div>
                        <div className="truncate text-xs text-slate-500">{specLine(p)}</div>
                      </div>
                      <div className={`shrink-0 tabular-nums ${!p.price ? 'text-amber-800' : ''}`}>
                        {p.price ? formatHuf(p.price.medianHuf) : p.estimate ? `kb. ${formatHuf(p.estimate.medianHuf)}` : '–'}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-200 px-3 py-2">
                <div>
                  <span className="text-slate-500">Összesen: </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {result.estimated > 0 ? '≈ ' : ''}
                    {formatHuf(result.totalHuf)}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  Processzor: {result.cpuScore ?? '–'} pont · Videókártya: {result.gpuScore !== undefined ? `${result.gpuScore} pont` : 'integrált'}
                </div>
              </div>
              {result.notes.length > 0 && (
                <ul className="space-y-1 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
                  {result.notes.map((n) => (
                    <li key={n}>· {n}</li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-2 border-t border-slate-100 px-3 py-2">
                <button onClick={run} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                  Újraszámolás
                </button>
                <button
                  onClick={() => onLoad(result.selection, `${PROFILE_TEXT[profile].title}, ${noBudget ? 'keret nélkül' : `${formatHuf(budgetHuf)} keret`}`)}
                  className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
                >
                  Betöltés a szerkesztőbe
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-400">
            A gépet a böngésződ állítja össze az adatbázisból: a processzor és a videókártya minden ésszerű párosítását végigpróbálja,
            a többi alkatrészből a legolcsóbb illeszkedőt választja (minőségi minimummal a tápnál és a háznál), és a legjobb
            ár-teljesítmény arányút adja. A teljesítménypontok becslések; a kész gépet a teljes kompatibilitás-ellenőrzés is
            átnézi. Betöltés után linkként is megosztható.
          </p>
        </div>
      </div>
    </div>
  )
}
