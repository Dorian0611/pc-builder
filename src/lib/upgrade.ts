// Upgrade advisor: what is worth replacing in an existing build, for how much.
//
// Works on the relative performance scores (scripts/perf.mjs): CPU 100 = Ryzen 5 7600,
// GPU 100 = RTX 4060. Gaming performance is limited by the GPU until the CPU can't keep
// up; we model that as min(gpu, CPU_CAP × cpu). Everything here is an estimate.

import { candidateErrors } from './builder'
import type { Catalog } from './catalog'
import { estimatePower } from './compat'
import { effectivePrice } from './estimates'
import type { BuildSelection, Category, Cpu, Gpu, Part, ResolvedBuild } from './types'

/** A CPU with score c can feed a GPU of score up to CPU_CAP × c before it holds it back. */
export const CPU_CAP = 2
/** Below this GPU/CPU ratio the GPU is clearly the limit. */
const GPU_BOUND_RATIO = 1.2
/** Typical desktop integrated graphics, in GPU score units. */
export const IGPU_SCORE = 10
/** Smaller gains are not worth recommending. */
export const MIN_GAIN = 0.1

export type Limiter = 'cpu' | 'gpu' | 'balanced'

export interface Balance {
  cpu?: number
  gpu?: number
  /** estimated gaming performance in GPU units (undefined when it can't be told) */
  gaming?: number
  limiter?: Limiter
}

export function gamingScore(cpu: number | undefined, gpu: number | undefined): number | undefined {
  if (gpu === undefined) return undefined
  return cpu === undefined ? gpu : Math.min(gpu, CPU_CAP * cpu)
}

/**
 * How a CPU/GPU pair performs. The general model uses the scores; a game model (games.ts)
 * turns them into FPS for one game and resolution.
 */
export interface PerfModel {
  /** higher is better; undefined when it can't be told (e.g. no GPU score) */
  score(cpu: number | undefined, gpu: number | undefined): number | undefined
  limiter(cpu: number, gpu: number): Limiter
}

/**
 * Limiter from what each part alone could deliver (same units). The CPU only counts as
 * the limit when a faster one would bring a noticeable gain.
 */
export function limiterOf(cpuCan: number, gpuCan: number): Limiter {
  if (gpuCan >= cpuCan * (1 + MIN_GAIN)) return 'cpu'
  if (gpuCan < cpuCan * (GPU_BOUND_RATIO / CPU_CAP)) return 'gpu'
  return 'balanced'
}

export const GENERAL_MODEL: PerfModel = {
  score: gamingScore,
  limiter: (cpu, gpu) => limiterOf(CPU_CAP * cpu, gpu),
}

const gpuScoreOf = (b: ResolvedBuild): number | undefined =>
  b.gpu ? b.gpu.perfScore : b.cpu?.integratedGraphics ? IGPU_SCORE : undefined

export function balance(b: ResolvedBuild, model: PerfModel = GENERAL_MODEL): Balance {
  const cpu = b.cpu?.perfScore
  const gpu = gpuScoreOf(b)
  const gaming = model.score(cpu, gpu)
  const limiter = cpu !== undefined && gpu !== undefined ? model.limiter(cpu, gpu) : undefined
  return { cpu, gpu, gaming, limiter }
}

export interface Suggestion {
  part: Part
  priceHuf: number
  /** gaming performance after the swap / before, minus 1 (null: there is nothing to compare to) */
  gain: number | null
  /** estimated gaming performance after the swap (ranking) */
  score: number
  /** the swap also needs a stronger PSU (wattage or connectors) */
  needsPsu: boolean
  /** after the swap, which part limits performance */
  limitedBy?: Limiter
}

const PSU_RULES = new Set(['psu-wattage', 'psu-connectors'])

/** Replace everything in a category with one part (a memory kit replaces all sticks). */
export function withReplaced(sel: BuildSelection, part: Part): BuildSelection {
  return { ...sel, [part.category]: [part.id] }
}

/**
 * Candidates for one category that fit the rest of the build. A candidate whose only
 * problem is the PSU is kept and flagged; anything else that would be red is dropped.
 */
function fitting<T extends Part>(catalog: Catalog, sel: BuildSelection, list: T[]): { part: T; needsPsu: boolean; price: number }[] {
  const out: { part: T; needsPsu: boolean; price: number }[] = []
  for (const part of list) {
    const price = effectivePrice(part)
    if (price === undefined) continue
    const rest = { ...sel, [part.category]: [] }
    const errors = candidateErrors(catalog, rest, part)
    if (errors.some((e) => !PSU_RULES.has(e.rule))) continue
    out.push({ part, needsPsu: errors.length > 0, price })
  }
  return out
}

/**
 * Price/performance frontier: only parts that beat every cheaper one. Best first.
 */
export function frontier(cands: Suggestion[]): Suggestion[] {
  const sorted = [...cands].sort((a, b) => a.priceHuf - b.priceHuf || b.score - a.score)
  const out: Suggestion[] = []
  let best = -Infinity
  for (const c of sorted)
    if (c.score > best) {
      out.push(c)
      best = c.score
    }
  return out.reverse()
}

/** Gain per forint (score per forint when there is nothing to compare to). */
const valueOf = (s: Suggestion) => (s.gain ?? s.score) / s.priceHuf

/**
 * A spread from the frontier rather than its top: the strongest one, the best value
 * (gain per forint) and the cheapest one still worth it.
 */
export function pickSpread(front: Suggestion[]): Suggestion[] {
  if (front.length <= 3) return front
  const value = front.reduce((a, b) => (valueOf(b) > valueOf(a) ? b : a))
  return [...new Set([front[0], value, front[front.length - 1]])]
}

export interface Advice {
  balance: Balance
  gpu: Suggestion[]
  cpu: Suggestion[]
  /** a faster CPU than the current one fits this board at all (gain aside) */
  fasterCpuFits: boolean
  /** simple fixes that are not about frames: too little RAM, no SSD, weak PSU */
  other: { reason: string; suggestion: Suggestion }[]
}

/**
 * @param budgetHuf  only suggest parts up to this price (undefined: no limit)
 */
export function adviseUpgrades(catalog: Catalog, sel: BuildSelection, budgetHuf?: number, model: PerfModel = GENERAL_MODEL): Advice {
  const b = catalog.resolveBuild(sel)
  const bal = balance(b, model)
  const affordable = (s: { price: number }) => budgetHuf === undefined || s.price <= budgetHuf

  // ---- graphics card
  const gpuNow = bal.gaming
  const gpuCands: Suggestion[] = []
  if (b.gpu?.perfScore !== undefined || !b.gpu)
    for (const c of fitting(catalog, sel, catalog.data.gpu.filter((g: Gpu) => g.perfScore !== undefined && g.id !== b.gpu?.id))) {
      if (!affordable(c)) continue
      const after = model.score(bal.cpu, c.part.perfScore)!
      const gain = gpuNow ? after / gpuNow - 1 : null
      if (gain !== null && gain < MIN_GAIN) continue
      const limitedBy = bal.cpu !== undefined ? model.limiter(bal.cpu, c.part.perfScore!) : undefined
      gpuCands.push({ part: c.part, priceHuf: c.price, gain, score: after, needsPsu: c.needsPsu, limitedBy })
    }

  // ---- processor (on the current board: same socket, memory type…)
  const cpuCands: Suggestion[] = []
  let fasterCpuFits = false
  if (b.cpu?.perfScore !== undefined)
    for (const c of fitting(catalog, sel, catalog.data.cpu.filter((x: Cpu) => x.perfScore !== undefined && x.id !== b.cpu!.id))) {
      if (c.part.perfScore! > b.cpu.perfScore * (1 + MIN_GAIN)) fasterCpuFits = true
      if (!affordable(c)) continue
      // without a graphics card the CPU's own speed is what counts
      const before = gpuScoreOf(b) !== undefined ? model.score(bal.cpu, gpuScoreOf(b)) : bal.cpu
      const after = gpuScoreOf(b) !== undefined ? model.score(c.part.perfScore, gpuScoreOf(b)) : c.part.perfScore
      const gain = before && after ? after / before - 1 : null
      if (gain === null || gain < MIN_GAIN) continue
      cpuCands.push({ part: c.part, priceHuf: c.price, gain, score: after!, needsPsu: c.needsPsu })
    }

  // ---- other fixes
  const other: Advice['other'] = []
  const cheapest = (category: Category, test: (p: Part) => boolean) => {
    const list = (catalog.data[category] as Part[]).filter(test)
    const ok = fitting(catalog, sel, list).filter((c) => !c.needsPsu && affordable(c))
    ok.sort((a, b) => a.price - b.price)
    return ok[0] && { part: ok[0].part, priceHuf: ok[0].price, gain: null, score: 0, needsPsu: false }
  }

  const ramGb = b.memory.reduce((s, m) => s + m.modules * m.moduleSizeGb, 0)
  if (b.memory.length > 0 && ramGb <= 16) {
    const s = cheapest('memory', (p) => p.category === 'memory' && p.modules === 2 && p.moduleSizeGb === 16)
    const reason =
      ramGb < 16
        ? `${ramGb} GB memória kevés a mai játékokhoz – 32 GB (2 × 16) ajánlott.`
        : '16 GB memória a minimum; sok mai játék és a háttérben futó programok miatt 32 GB (2 × 16) ajánlott.'
    if (s) other.push({ reason, suggestion: s })
  }

  if (b.storage.length > 0 && !b.storage.some((s) => s.kind === 'SSD')) {
    const s = cheapest('storage', (p) => p.category === 'storage' && p.kind === 'SSD' && p.capacityGb >= 1000 && p.capacityGb < 2000)
    if (s) other.push({ reason: 'Nincs SSD a gépben – egy SSD-re telepített rendszer és játékok sokkal gyorsabban töltenek.', suggestion: s })
  }

  if (b.psu) {
    const need = estimatePower(b).recommendedW
    if (b.psu.wattage < need) {
      const s = cheapest('psu', (p) => p.category === 'psu' && p.wattage >= need)
      if (s) other.push({ reason: `A ${b.psu.wattage} W-os táp kevés ehhez a géphez (javasolt legalább ${need} W).`, suggestion: s })
    }
  }

  return {
    balance: bal,
    gpu: pickSpread(frontier(gpuCands)),
    cpu: pickSpread(frontier(cpuCands)),
    fasterCpuFits,
    other,
  }
}
