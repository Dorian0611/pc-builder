// Upgrade advisor: what is worth replacing in an existing build, for how much.
//
// Works on the relative performance scores (scripts/perf.mjs): CPU 100 = Ryzen 5 7600,
// GPU 100 = RTX 4060. Gaming performance is limited by the GPU until the CPU can't keep
// up; we model that as min(gpu, CPU_CAP × cpu). Everything here is an estimate.

import { candidateErrors } from './builder'
import type { Catalog } from './catalog'
import { checkBuild, estimatePower } from './compat'
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
  /** combined upgrade: these are swapped together with `part` (priceHuf is the total) */
  also?: Part[]
  /** platform change: the current memory kit / cooler can stay */
  keeps?: ('memory' | 'cooler')[]
}

const PSU_RULES = new Set(['psu-wattage', 'psu-connectors'])

/** Replace everything in a category with one part (a memory kit replaces all sticks). */
export function withReplaced(sel: BuildSelection, part: Part): BuildSelection {
  return { ...sel, [part.category]: [part.id] }
}

/** Every part a suggestion swaps in. */
export const partsOf = (s: Suggestion): Part[] => [s.part, ...(s.also ?? [])]

/** The build after applying a suggestion. */
export const applySuggestion = (sel: BuildSelection, s: Suggestion): BuildSelection => partsOf(s).reduce(withReplaced, sel)

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
  /** processor + graphics card together (only when clearly better than either alone) */
  combo: Suggestion[]
  /** new platform: processor + board (+ memory, cooler when needed) */
  platform: Suggestion[]
  /** new platform and a new graphics card */
  platformGpu: Suggestion[]
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

  // the parts that fit the rest of the build at all (any price)
  const gpuFit =
    b.gpu?.perfScore !== undefined || !b.gpu
      ? fitting(catalog, sel, catalog.data.gpu.filter((g: Gpu) => g.perfScore !== undefined && g.id !== b.gpu?.id))
      : []
  const cpuFit =
    b.cpu?.perfScore !== undefined ? fitting(catalog, sel, catalog.data.cpu.filter((x: Cpu) => x.perfScore !== undefined && x.id !== b.cpu!.id)) : []

  // ---- graphics card
  const gpuNow = bal.gaming
  const gpuCands: Suggestion[] = []
  for (const c of gpuFit) {
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
    for (const c of cpuFit) {
      if (c.part.perfScore! > b.cpu.perfScore * (1 + MIN_GAIN)) fasterCpuFits = true
      if (!affordable(c)) continue
      // without a graphics card the CPU's own speed is what counts
      const before = gpuScoreOf(b) !== undefined ? model.score(bal.cpu, gpuScoreOf(b)) : bal.cpu
      const after = gpuScoreOf(b) !== undefined ? model.score(c.part.perfScore, gpuScoreOf(b)) : c.part.perfScore
      const gain = before && after ? after / before - 1 : null
      if (gain === null || gain < MIN_GAIN) continue
      cpuCands.push({ part: c.part, priceHuf: c.price, gain, score: after!, needsPsu: c.needsPsu })
    }

  // ---- processor + graphics card together
  const gpuPick = pickSpread(frontier(gpuCands))
  const cpuPick = pickSpread(frontier(cpuCands))
  const combo = combos(catalog, sel, model, bal, cpuFit, gpuFit, budgetHuf, Math.max(0, ...gpuPick.map((s) => s.score), ...cpuPick.map((s) => s.score)))

  // ---- new platform (other socket), alone or with a new graphics card
  const { platform, platformGpu } = platformBundles(catalog, sel, model, bal, gpuFit, budgetHuf, {
    cpuOnly: Math.max(0, ...cpuPick.map((s) => s.score)),
    overall: Math.max(0, ...[...gpuPick, ...cpuPick, ...combo].map((s) => s.score)),
  })

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
    gpu: gpuPick,
    cpu: cpuPick,
    combo,
    platform,
    platformGpu,
    fasterCpuFits,
    other,
  }
}

type Fit<T extends Part> = { part: T; needsPsu: boolean; price: number }

/** Only the parts that beat every cheaper one on their own score – the rest can't be in a best pair. */
function partFrontier<T extends Cpu | Gpu>(list: Fit<T>[], above: number): Fit<T>[] {
  const sorted = list.filter((c) => c.part.perfScore! > above).sort((a, b) => a.price - b.price)
  const out: Fit<T>[] = []
  let best = -Infinity
  for (const c of sorted)
    if (c.part.perfScore! > best) {
      out.push(c)
      best = c.part.perfScore!
    }
  return out
}

/**
 * Processor and graphics card swapped together, when the pair clearly beats the best
 * single swap (`bestSingle`): typically an old CPU with an old GPU, where either alone
 * soon runs into the other. Checked together for compatibility and the PSU.
 */
function combos(
  catalog: Catalog,
  sel: BuildSelection,
  model: PerfModel,
  bal: Balance,
  cpuFit: Fit<Cpu>[],
  gpuFit: Fit<Gpu>[],
  budgetHuf: number | undefined,
  bestSingle: number,
): Suggestion[] {
  const now = bal.gaming
  if (!now || bal.cpu === undefined || bal.gpu === undefined) return []
  const cpus = partFrontier(cpuFit, bal.cpu * (1 + MIN_GAIN))
  const gpus = partFrontier(gpuFit, bal.gpu * (1 + MIN_GAIN))
  const floor = Math.max(now, bestSingle) * (1 + MIN_GAIN)
  const pairs: Suggestion[] = []
  for (const c of cpus)
    for (const g of gpus) {
      const price = c.price + g.price
      if (budgetHuf !== undefined && price > budgetHuf) continue
      const score = model.score(c.part.perfScore, g.part.perfScore)
      if (score === undefined || score < floor) continue
      pairs.push({ part: c.part, also: [g.part], priceHuf: price, score, gain: score / now - 1, needsPsu: false })
    }
  // the together-check (PSU wattage for both, etc.) only for the few that are shown
  const out: Suggestion[] = []
  for (const s of pickSpread(frontier(pairs))) {
    const errors = checkBuild(catalog.resolveBuild(applySuggestion(sel, s))).filter((e) => e.level === 'error')
    if (errors.some((e) => !PSU_RULES.has(e.rule))) continue
    out.push({ ...s, needsPsu: errors.length > 0 })
  }
  return out
}

// ---------------------------------------------------------------- platform change

/** Entry-level chipsets: fine for 65 W CPUs, weak power delivery for the big ones. */
const ENTRY_CHIPSET = /^(A320|A520|A620|H310|H410|H510|H610|H810)/i
const isStrongCpu = (c: Cpu) => (c.tdpW ?? 0) > 65 || (c.peakW ?? 0) > 120

/** Memory size of a new kit when the memory type changes (DDR4 → DDR5). */
const NEW_KIT = { modules: 2, moduleSizeGb: 16 }

/**
 * New processor on a different socket: CPU + the cheapest board for it that fits the case
 * (and the rest of the build), a new memory kit only if the memory type changes, a new
 * cooler only if the old one doesn't fit the socket. Optionally with a new graphics card.
 * Each bundle is priced as a whole and checked as a whole build.
 */
export function platformBundles(
  catalog: Catalog,
  sel: BuildSelection,
  model: PerfModel,
  bal: Balance,
  gpuFit: Fit<Gpu>[],
  budgetHuf: number | undefined,
  /** best scores the simpler upgrades reach: a CPU on the current board / anything */
  best: { cpuOnly: number; overall: number },
): { platform: Suggestion[]; platformGpu: Suggestion[] } {
  const none = { platform: [], platformGpu: [] }
  const b = catalog.resolveBuild(sel)
  const now = bal.gaming
  if (!b.cpu || !b.motherboard || !now || bal.cpu === undefined) return none
  const gpuNow = gpuScoreOf(b)
  const rest: BuildSelection = { ...sel, cpu: [], motherboard: [], memory: [], cooler: [] }
  const priced = <T extends Part>(list: T[]) =>
    list
      .map((part) => ({ part, price: effectivePrice(part)! }))
      .filter((x) => x.price !== undefined)
      .sort((x, y) => x.price - y.price)

  // cheapest board per socket + memory type (+ class) that fits the case and the rest;
  // strong CPUs get no entry-level chipset – their power delivery is not made for them
  const boards = new Map<string, { part: Part; price: number }>()
  for (const x of priced(catalog.data.motherboard)) {
    if (x.part.socket === b.motherboard.socket) continue
    const entry = ENTRY_CHIPSET.test(x.part.chipset ?? '')
    const keys = [`${x.part.socket}|${x.part.memoryType}|any`, ...(entry ? [] : [`${x.part.socket}|${x.part.memoryType}|strong`])].filter(
      (k) => !boards.has(k),
    )
    if (keys.length === 0) continue
    if (candidateErrors(catalog, rest, x.part).some((e) => !PSU_RULES.has(e.rule))) continue
    for (const k of keys) boards.set(k, x)
  }

  // memory: keep the current kit when the type stays, else the cheapest 2 × 16 GB kit
  const curType = b.memory[0]?.memoryType
  const kits = new Map<string, { part: Part; price: number }>()
  for (const x of priced(catalog.data.memory))
    if (x.part.modules === NEW_KIT.modules && x.part.moduleSizeGb === NEW_KIT.moduleSizeGb && !kits.has(x.part.memoryType)) kits.set(x.part.memoryType, x)

  // cooler: only if there is one and it doesn't support the new socket
  const coolerFor = new Map<string, { part: Part; price: number } | null>()
  const maxH = b.case?.maxCoolerHeightMm
  const cooler = (socket: string) => {
    if (!b.cooler || b.cooler.sockets.includes(socket)) return null
    if (!coolerFor.has(socket))
      coolerFor.set(
        socket,
        priced(catalog.data.cooler).find((x) => x.part.type === 'air' && x.part.sockets.includes(socket) && (maxH === undefined || (x.part.heightMm ?? 999) <= maxH)) ?? null,
      )
    return coolerFor.get(socket) ?? undefined
  }

  // every faster CPU on another socket, with its cheapest complete platform
  type Bundle = { cpu: Cpu; extra: { part: Part; price: number }[]; keeps: ('memory' | 'cooler')[]; price: number }
  const bundles: Bundle[] = []
  for (const c of priced(catalog.data.cpu)) {
    if (c.part.socket === b.motherboard.socket || c.part.perfScore === undefined || c.part.perfScore <= bal.cpu * (1 + MIN_GAIN)) continue
    let best: Bundle | undefined
    for (const mt of c.part.memoryTypes?.length ? c.part.memoryTypes : ['DDR4', 'DDR5']) {
      const board = boards.get(`${c.part.socket}|${mt}|${isStrongCpu(c.part) ? 'strong' : 'any'}`)
      if (!board) continue
      const keepRam = curType === mt && b.memory.length > 0
      const kit = keepRam ? null : kits.get(mt)
      if (kit === undefined) continue
      const cool = cooler(c.part.socket)
      if (cool === undefined) continue
      const extra = [board, kit, cool].filter((x): x is { part: Part; price: number } => !!x)
      const keeps: Bundle['keeps'] = [...(keepRam ? ['memory' as const] : []), ...(b.cooler && !cool ? ['cooler' as const] : [])]
      const price = c.price + extra.reduce((s, x) => s + x.price, 0)
      if (!best || price < best.price) best = { cpu: c.part, extra, keeps, price }
    }
    if (best) bundles.push(best)
  }

  const toSuggestion = (x: Bundle, gpu?: Fit<Gpu>): Suggestion | undefined => {
    const price = x.price + (gpu?.price ?? 0)
    if (budgetHuf !== undefined && price > budgetHuf) return undefined
    const score = model.score(x.cpu.perfScore, gpu ? gpu.part.perfScore : gpuNow)
    if (score === undefined) return undefined
    return { part: x.cpu, also: [...x.extra.map((e) => e.part), ...(gpu ? [gpu.part] : [])], keeps: x.keeps, priceHuf: price, score, gain: score / now - 1, needsPsu: false }
  }
  /** keeps the ones clearly above `floor`, spread, each checked as a whole build */
  const finish = (list: (Suggestion | undefined)[], floor: number) => {
    const ok = list.filter((s): s is Suggestion => !!s && s.score >= floor)
    const out: Suggestion[] = []
    for (const s of pickSpread(frontier(ok))) {
      const errors = checkBuild(catalog.resolveBuild(applySuggestion(sel, s))).filter((e) => e.level === 'error')
      if (errors.some((e) => !PSU_RULES.has(e.rule))) continue
      out.push({ ...s, needsPsu: errors.length > 0 })
    }
    return out
  }

  const floor1 = Math.max(now, best.cpuOnly) * (1 + MIN_GAIN)
  const platform = gpuNow === undefined ? [] : finish(bundles.map((x) => toSuggestion(x)), floor1)

  // with a new graphics card: only price/performance-frontier bundles and cards can be in a best pair
  const bundleFront = (() => {
    const sorted = [...bundles].sort((x, y) => x.price - y.price)
    const out: Bundle[] = []
    let top = -Infinity
    for (const x of sorted)
      if (x.cpu.perfScore! > top) {
        out.push(x)
        top = x.cpu.perfScore!
      }
    return out
  })()
  const gpus = partFrontier(gpuFit, (bal.gpu ?? 0) * (1 + MIN_GAIN))
  const floor2 = Math.max(now, best.overall, ...platform.map((s) => s.score)) * (1 + MIN_GAIN)
  const platformGpu = finish(
    bundleFront.flatMap((x) => gpus.map((g) => toSuggestion(x, g))),
    floor2,
  )
  return { platform, platformGpu }
}
