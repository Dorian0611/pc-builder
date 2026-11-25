// Build plan for a platform change: the bundle split into steps that can be bought one by
// one, in a sensible order, with the price and the expected performance after each step.
//
// What has to go together: the new CPU needs the new board (other socket); a new memory kit
// of another type (DDR4 → DDR5) and a cooler for the new socket only work on the new board.
// The graphics card works in either machine, so it is a step of its own. When a step needs
// more power than the current PSU gives, a PSU step comes first.

import { checkBuild, estimatePower } from './compat'
import { effectivePrice } from './estimates'
import type { Catalog } from './catalog'
import type { BuildSelection, Part, Psu, ResolvedBuild } from './types'
import { IGPU_SCORE, partsOf, withReplaced, type PerfModel, type Suggestion } from './upgrade'

export type StepKind = 'psu' | 'platform' | 'gpu'

export interface PlanStep {
  kind: StepKind
  parts: Part[]
  priceHuf: number
  /** performance after this step (model units: FPS in game mode) */
  score?: number
  /** why these parts go together / why this order */
  why: string
}

export interface BuildPlan {
  steps: PlanStep[]
  totalHuf: number
  /** the other order: what its first step would give (to show why this order is better) */
  alternative?: { kind: StepKind; score?: number }
}

const PLATFORM_CATEGORIES = new Set(['cpu', 'motherboard', 'memory', 'cooler'])
const PSU_RULES = new Set(['psu-wattage', 'psu-connectors'])

const apply = (sel: BuildSelection, parts: Part[]) => parts.reduce(withReplaced, sel)
const priceOf = (parts: Part[]) => parts.reduce((s, p) => s + (effectivePrice(p) ?? 0), 0)
const gpuScore = (b: ResolvedBuild) => (b.gpu ? b.gpu.perfScore : b.cpu?.integratedGraphics ? IGPU_SCORE : undefined)
const scoreOf = (catalog: Catalog, sel: BuildSelection, model: PerfModel) => {
  const b = catalog.resolveBuild(sel)
  return model.score(b.cpu?.perfScore, gpuScore(b))
}
const psuTrouble = (catalog: Catalog, sel: BuildSelection) =>
  checkBuild(catalog.resolveBuild(sel)).some((e) => e.level === 'error' && PSU_RULES.has(e.rule))

/** Cheapest PSU (with a price) that makes the final build pass the PSU rules. */
function cheapestPsu(catalog: Catalog, finalSel: BuildSelection): Psu | undefined {
  const need = estimatePower(catalog.resolveBuild(finalSel)).recommendedW
  const list = catalog.data.psu
    .filter((p) => p.wattage >= need && effectivePrice(p) !== undefined)
    .sort((a, b) => effectivePrice(a)! - effectivePrice(b)!)
  return list.find((p) => {
    const errors = checkBuild(catalog.resolveBuild(withReplaced(finalSel, p))).filter((e) => e.level === 'error')
    return !errors.some((e) => PSU_RULES.has(e.rule) || e.rule === 'psu-size')
  })
}

function platformWhy(catalog: Catalog, sel: BuildSelection, parts: Part[]): string {
  const now = catalog.resolveBuild(sel)
  const cpu = parts.find((p) => p.category === 'cpu') as { socket: string } | undefined
  const board = parts.find((p) => p.category === 'motherboard') as { memoryType: string } | undefined
  const reasons = [`az új processzor más foglalatú (${cpu?.socket ?? '?'}), ezért új alaplap kell hozzá`]
  if (parts.some((p) => p.category === 'memory') && board)
    reasons.push(`az új alaplap ${board.memoryType} memóriát fogad, a mostani ${now.memory[0]?.memoryType ?? ''} nem jó bele`)
  if (parts.some((p) => p.category === 'cooler')) reasons.push('a mostani hűtő nem illik az új foglalathoz')
  const what = ['a processzor', 'az alaplap', ...(parts.some((p) => p.category === 'memory') ? ['a memória'] : []), ...(parts.some((p) => p.category === 'cooler') ? ['a hűtő'] : [])]
  const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} és ${what[what.length - 1]}` : what[0]
  return `${list[0].toUpperCase()}${list.slice(1)} csak együtt cserélhető: ${reasons.join('; ')}.`
}

/**
 * @param sel    the current build
 * @param s      a platform suggestion (part = new CPU, also = board, memory, cooler, GPU…)
 */
export function buildPlan(catalog: Catalog, sel: BuildSelection, s: Suggestion, model: PerfModel): BuildPlan {
  const all = partsOf(s)
  const platform = all.filter((p) => PLATFORM_CATEGORIES.has(p.category))
  const gpu = all.filter((p) => p.category === 'gpu')

  // two orders when there is a GPU: pick the one whose first step gives more per forint
  const groups: { kind: StepKind; parts: Part[] }[][] = gpu.length
    ? [
        [{ kind: 'gpu', parts: gpu }, { kind: 'platform', parts: platform }],
        [{ kind: 'platform', parts: platform }, { kind: 'gpu', parts: gpu }],
      ]
    : [[{ kind: 'platform', parts: platform }]]

  const now = scoreOf(catalog, sel, model) ?? 0
  const firstValue = (order: { parts: Part[] }[]) => ((scoreOf(catalog, apply(sel, order[0].parts), model) ?? now) - now) / Math.max(1, priceOf(order[0].parts))
  const order = groups.reduce((a, b) => (firstValue(b) > firstValue(a) ? b : a))

  // the PSU: bought before the first step that needs more power than the current one gives
  const finalSel = apply(sel, all)
  const psu = psuTrouble(catalog, finalSel) ? cheapestPsu(catalog, finalSel) : undefined
  const steps: PlanStep[] = []
  let cur = sel
  let psuDone = !psu
  for (const g of order) {
    const next = apply(cur, g.parts)
    if (!psuDone && psuTrouble(catalog, next)) {
      const b = catalog.resolveBuild(cur)
      const need = estimatePower(catalog.resolveBuild(finalSel)).recommendedW
      cur = withReplaced(cur, psu!)
      steps.push({
        kind: 'psu',
        parts: [psu!],
        priceHuf: priceOf([psu!]),
        score: scoreOf(catalog, cur, model),
        why: `A következő lépéshez kell: a mostani ${b.psu ? `${b.psu.wattage} W-os ` : ''}táp kevés (a kész géphez javasolt legalább ${need} W), és a mostani gépben is működik.`,
      })
      psuDone = true
    }
    cur = apply(cur, g.parts)
    const score = scoreOf(catalog, cur, model)
    const why =
      g.kind === 'platform'
        ? platformWhy(catalog, sel, g.parts)
        : steps.some((x) => x.kind === 'platform')
          ? 'A videókártya az új platformon már teljes erővel dolgozhat.'
          : 'A videókártya a mostani gépben is működik, ezért külön, előre is megveheted; a régi processzor ilyenkor még visszafoghatja.'
    steps.push({ kind: g.kind, parts: g.parts, priceHuf: priceOf(g.parts), score, why })
  }
  // a PSU that no single step needed but the final build does
  if (!psuDone && psu) {
    cur = withReplaced(cur, psu)
    steps.push({ kind: 'psu', parts: [psu], priceHuf: priceOf([psu]), score: scoreOf(catalog, cur, model), why: 'A kész géphez erősebb táp kell.' })
  }
  const other = groups.find((g) => g !== order)
  return {
    steps,
    totalHuf: steps.reduce((t, x) => t + x.priceHuf, 0),
    alternative: other && { kind: other[0].kind, score: scoreOf(catalog, apply(sel, other[0].parts), model) },
  }
}
