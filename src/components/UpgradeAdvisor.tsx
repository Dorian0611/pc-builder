import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { formatHuf } from '../lib/builder'
import type { Catalog } from '../lib/catalog'
import { formatFps, gameModel, loadGames, RESOLUTIONS, type GameList, type Resolution } from '../lib/games'
import { fullName, specLine } from '../lib/specs'
import { adviseUpgrades, GENERAL_MODEL, partsOf, type Limiter, type Suggestion } from '../lib/upgrade'
import { buildPlan, type BuildPlan, type StepKind } from '../lib/plan'
import type { BuildSelection, Part } from '../lib/types'

interface Props {
  catalog: Catalog
  selection: BuildSelection
  /** one part, or a CPU + GPU pair swapped together */
  onApply: (parts: Part[]) => void
}

const LIMITER_TEXT: Record<Limiter, string> = {
  cpu: 'A processzor fogja vissza a videókártyát: erősebb processzorral több FPS jönne ki a gépből.',
  gpu: 'A videókártya a szűk keresztmetszet – a processzor egy erősebb kártyát is kiszolgálna.',
  balanced: 'A processzor és a videókártya jól illik egymáshoz.',
}

const pct = (g: number) => `+${Math.round(g * 100)}%`

/** before → after: FPS in game mode, % gain otherwise */
const show = (score: number | undefined, before: number | undefined, fps: boolean) =>
  fps ? `kb. ${formatFps(score)} FPS` : score !== undefined && before ? pct(score / before - 1) : ''

const STEP_LABEL: Record<StepKind, string> = { psu: 'Táp', platform: 'Platform', gpu: 'Videókártya' }

/** „Ha nem egyszerre cserélnéd” – the bundle as steps. */
function PlanView({ plan, before, fps, onApply }: { plan: BuildPlan; before?: number; fps: boolean; onApply: (p: Part[]) => void }) {
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <ol className="space-y-3">
        {plan.steps.map((st, i) => (
          <li key={st.kind} className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{STEP_LABEL[st.kind]}</span>
                <span className="tabular-nums text-slate-600">{formatHuf(st.priceHuf)}</span>
                {st.score !== undefined && <span className="font-semibold text-emerald-700">utána {show(st.score, before, fps)}</span>}
              </div>
              <div className="truncate text-slate-700">{st.parts.map(fullName).join(' + ')}</div>
              <div className="text-xs text-slate-500">{st.why}</div>
            </div>
            <button
              onClick={() => onApply(st.parts)}
              className="h-fit shrink-0 rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
              title="Csak ezt a lépést tölti be az összeállításba"
            >
              Csak ez
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
        Összesen: <span className="font-medium tabular-nums">{formatHuf(plan.totalHuf)}</span>
        {plan.steps.some((x) => x.kind === 'psu') && ' (az új táppal együtt)'}
        {plan.alternative?.score !== undefined && (
          <div className="mt-1 text-slate-500">
            Miért ez a sorrend? Ha előbb a {plan.alternative.kind === 'gpu' ? 'videókártyát' : 'platformot'} cserélnéd, az első lépés után
            {plan.alternative.score < (plan.steps.find((x) => x.kind !== 'psu')?.score ?? 0)
              ? ` csak ${show(plan.alternative.score, before, fps) || 'kevesebb'} lenne – így az első lépés többet ad.`
              : ` ${show(plan.alternative.score, before, fps)} lenne, de az a lépés forintonként kevesebbet hoz.`}
          </div>
        )}
      </div>
    </div>
  )
}

function Row({
  s,
  before,
  fps,
  onApply,
  planFor,
}: {
  s: Suggestion
  before?: number
  fps: boolean
  onApply: (p: Part[]) => void
  planFor?: (s: Suggestion) => BuildPlan
}) {
  const parts = partsOf(s)
  const estimated = parts.some((p) => !p.price)
  const [planOpen, setPlanOpen] = useState(false)
  const plan = useMemo(() => (planOpen && planFor ? planFor(s) : null), [planOpen, planFor, s])
  return (
    <li className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          {parts.map((p, i) => (
            <div key={p.id}>
              <div className="truncate font-medium" title={fullName(p)}>
                {i > 0 && <span className="text-slate-400">+ </span>}
                {fullName(p)}
              </div>
              <div className="truncate text-xs text-slate-500">{specLine(p)}</div>
            </div>
          ))}
          {s.keeps?.length ? (
            <div className="text-xs text-slate-500">
              Marad a mostani {s.keeps.map((k) => (k === 'memory' ? 'memória' : 'hűtő')).join(' és ')}.
            </div>
          ) : null}
          {s.needsPsu && <div className="text-xs text-amber-700">Erősebb táp is kell hozzá.</div>}
      </div>
      {s.gain !== null && (
        <div className="shrink-0 text-right text-sm font-semibold text-emerald-700" title="becsült javulás játékban">
          {fps ? (
            <>
              <span className="font-normal text-slate-500">{formatFps(before)} →</span> {formatFps(s.score)} FPS
            </>
          ) : (
            pct(s.gain)
          )}
        </div>
      )}
      <div className={`w-28 shrink-0 text-right text-sm tabular-nums ${estimated ? 'text-amber-800' : ''}`}>
        {estimated ? 'kb. ' : ''}
        {formatHuf(s.priceHuf)}
      </div>
      <button onClick={() => onApply(parts)} className="shrink-0 rounded-md border border-blue-600 px-2.5 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50">
        Csere
      </button>
      </div>
      {planFor && (
        <button onClick={() => setPlanOpen(!planOpen)} className="mt-1 text-xs font-medium text-blue-700 hover:underline">
          {planOpen ? 'Építési terv elrejtése ▴' : 'Építési terv – ha nem egyszerre cserélnéd ▾'}
        </button>
      )}
      {plan && <PlanView plan={plan} before={before} fps={fps} onApply={onApply} />}
    </li>
  )
}

const select = 'rounded border border-slate-300 bg-white px-2 py-1'

/** „Mit érdemes fejleszteni?” – a mostani összeállításból, általánosan vagy egy adott játékra. */
export function UpgradeAdvisor({ catalog, selection, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [budget, setBudget] = useState('')
  const [games, setGames] = useState<GameList | null>(null)
  const [gameId, setGameId] = useState('')
  const [res, setRes] = useState<Resolution>('1080p')

  useEffect(() => {
    if (open && !games) loadGames().then(setGames)
  }, [open, games])

  const game = games?.games.find((g) => g.id === gameId)
  const model = useMemo(() => (game ? gameModel(game, res) : GENERAL_MODEL), [game, res])

  const budgetHuf = Number(budget.replace(/\D/g, '')) || undefined
  // a sok jelölt végigellenőrzése ne akassza meg a gépelést / kattintást
  const deferredSel = useDeferredValue(selection)
  const deferredBudget = useDeferredValue(budgetHuf)
  const deferredModel = useDeferredValue(model)
  const advice = useMemo(
    () => (open ? adviseUpgrades(catalog, deferredSel, deferredBudget, deferredModel) : null),
    [open, catalog, deferredSel, deferredBudget, deferredModel],
  )
  const bal = advice?.balance
  const planFor = useCallback((s: Suggestion) => buildPlan(catalog, deferredSel, s, deferredModel), [catalog, deferredSel, deferredModel])
  const hasBase = !!selection.cpu?.length || !!selection.gpu?.length
  const fpsMode = !!game

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-4 text-left">
        <div>
          <h2 className="font-semibold">Mit érdemes fejleszteni? · FPS-becslés</h2>
          <p className="text-sm text-slate-500">
            Rakd össze a mostani gépedet (vagy nyisd meg a linkjét), válassz játékot, és megmutatjuk, melyik csere hozza a
            legtöbbet.
          </p>
        </div>
        <span className="ml-4 text-slate-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 px-5 py-4 text-sm">
          {/* ---- játék, felbontás, keret */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-slate-600">Játék:</span>
              <select value={gameId} onChange={(e) => setGameId(e.target.value)} className={`${select} max-w-[16rem]`}>
                <option value="">Általános (pontszám alapján)</option>
                {games?.games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.estimated ? ' (becsült)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {fpsMode && (
              <label className="flex items-center gap-2">
                <span className="text-slate-600">Felbontás:</span>
                <select value={res} onChange={(e) => setRes(e.target.value as Resolution)} className={select}>
                  {Object.entries(RESOLUTIONS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
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

          {game && (
            <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600">
              <div>
                <span className="font-medium text-slate-800">{game.name}</span>
                {game.rank && <span> · a Steam {game.rank}. legtöbbet játszott játéka</span>}
              </div>
              {(game.cpuText || game.gpuText) && (
                <div className="mt-1">
                  {game.estimated ? 'Becsült igény' : 'Ajánlott gépigény'} 60 FPS-hez (1080p):{' '}
                  {[game.cpuText && `processzor: ${game.cpuText}`, game.gpuText && `videókártya: ${game.gpuText}`].filter(Boolean).join(' · ')}
                </div>
              )}
              {game.note && <div className="mt-1 text-amber-800">{game.note}</div>}
            </div>
          )}

          {!hasBase && <p className="text-slate-500">Válassz legalább egy processzort vagy videókártyát.</p>}

          {hasBase && bal && (
            <>
              <dl className="flex flex-wrap gap-6">
                <div>
                  <dt className="text-xs text-slate-500">Processzor</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {bal.cpu ?? '–'} <span className="text-xs font-normal text-slate-500">pont</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Videókártya</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {bal.gpu ?? '–'}{' '}
                    <span className="text-xs font-normal text-slate-500">{selection.gpu?.length ? 'pont' : 'pont (integrált)'}</span>
                  </dd>
                </div>
                {fpsMode && (
                  <div>
                    <dt className="text-xs text-slate-500">Most ebben a játékban</dt>
                    <dd className="text-lg font-semibold tabular-nums text-blue-800">
                      kb. {formatFps(bal.gaming)} <span className="text-xs font-normal text-slate-500">FPS · {RESOLUTIONS[res].label}</span>
                    </dd>
                  </div>
                )}
              </dl>
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
                before={bal?.gaming}
                fps={fpsMode}
                empty={
                  bal?.limiter === 'cpu'
                    ? 'Ezzel a processzorral egy gyorsabb videókártya most nem hozna többet – előbb a processzort érdemes cserélni.'
                    : budgetHuf
                      ? 'Ebből a keretből nincs érdemben gyorsabb videókártya.'
                      : 'Nincs érdemben gyorsabb videókártya, aminek ára is van az adatbázisban.'
                }
                onApply={onApply}
              />
              {advice.gpu.some((s) => s.limitedBy === 'cpu') && (
                <p className="-mt-3 text-xs text-slate-500">
                  Ennél erősebb kártyát ez a processzor már visszafogna – nagyobb ugráshoz a processzort is cserélni kellene.
                </p>
              )}
              {selection.cpu?.length ? (
                <Group
                  title="Processzorcsere (ugyanebbe az alaplapba)"
                  list={advice.cpu}
                  before={bal?.gaming}
                  fps={fpsMode && bal?.gpu !== undefined}
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
              {advice.combo.length > 0 && (
                <Group
                  title="Processzor + videókártya együtt"
                  list={advice.combo}
                  before={bal?.gaming}
                  fps={fpsMode}
                  empty=""
                  onApply={onApply}
                />
              )}
              {advice.combo.length > 0 && (
                <p className="-mt-3 text-xs text-slate-500">
                  A két alkatrész itt egymást korlátozza, ezért együtt cserélve jóval többet hoznak, mint bármelyik külön. Az ár a kettő
                  együtt.
                </p>
              )}
              {advice.platform.length > 0 && (
                <Group
                  title="Platformváltás (új processzor + alaplap, ha kell memória és hűtő)"
                  list={advice.platform}
                  planFor={planFor}
                  before={bal?.gaming}
                  fps={fpsMode}
                  empty=""
                  onApply={onApply}
                />
              )}
              {advice.platformGpu.length > 0 && (
                <Group
                  title="Platformváltás + videókártya"
                  list={advice.platformGpu}
                  planFor={planFor}
                  before={bal?.gaming}
                  fps={fpsMode}
                  empty=""
                  onApply={onApply}
                />
              )}
              {advice.platform.length + advice.platformGpu.length > 0 && (
                <p className="-mt-3 text-xs text-slate-500">
                  Platformváltásnál az ár a teljes csomagé. A legolcsóbb, a házba illő alaplapot választottuk; új memória csak
                  akkor kell, ha a memória típusa változik (pl. DDR4 → DDR5), új hűtő csak akkor, ha a régi nem illik az új
                  foglalathoz.
                </p>
              )}
              {advice.other.length > 0 && (
                <div>
                  <h3 className="mb-2 font-medium">Egyéb javaslatok</h3>
                  <ul className="space-y-3">
                    {advice.other.map((o) => (
                      <li key={o.suggestion.part.id}>
                        <p className="mb-1 text-slate-700">{o.reason}</p>
                        <ul>
                          <Row s={o.suggestion} fps={false} onApply={onApply} />
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <p className="text-xs text-slate-400">
            Minden szám becslés. A pontszámok saját becslések a tipikus játékteljesítményre (processzor: Ryzen 5 7600 = 100,
            videókártya: RTX 4060 = 100). Az FPS-becslés abból indul ki, hogy a játék ajánlott gépigénye kb. 60 FPS-t ad 1080p-n
            közepes–magas beállítással; a valódi érték beállításonként és jelenetenként eltér. A játéklista a Steam legtöbbet
            játszott játékaiból havonta kétszer frissül{games ? ` (utoljára: ${games.updatedAt})` : ''}; a még PC-re meg nem
            jelent címek igénye becsült. Csak olyan alkatrészt ajánlunk, ami a többihez illik és van (becsült) ára.
          </p>
        </div>
      )}
    </section>
  )
}

function Group({
  title,
  list,
  before,
  fps,
  empty,
  onApply,
  planFor,
}: {
  title: string
  list: Suggestion[]
  before?: number
  fps: boolean
  empty: string
  onApply: (p: Part[]) => void
  planFor?: (s: Suggestion) => BuildPlan
}) {
  return (
    <div>
      <h3 className="mb-2 font-medium">{title}</h3>
      {list.length === 0 ? (
        <p className="text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((s) => (
            <Row key={partsOf(s).map((p) => p.id).join('+')} s={s} before={before} fps={fps} onApply={onApply} planFor={planFor} />
          ))}
        </ul>
      )}
    </div>
  )
}
