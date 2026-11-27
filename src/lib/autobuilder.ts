// Auto-builder: a complete, compatible build for a budget and a use-case profile.
// Runs entirely in the browser on the catalogue, prices, performance scores and the
// compatibility rules.
//
// How: the processor and the graphics card decide performance, so we take the price/
// performance frontier of both and try every pair. For each pair the rest is the cheapest
// part that fits: board (+ memory kit) for the CPU, cooler, SSD, a case that takes the board,
// the GPU and the cooler, a PSU with enough watts and connectors. The pair with the best
// profile score within the budget wins – or rather the cheapest pair within 2% of it, so the
// money goes where it shows. The winner is checked with the full compatibility rules.

import { ENTRY_CHIPSET, isStrongCpu } from './upgrade'
import { checkBuild, estimatePower } from './compat'
import { effectivePrice } from './estimates'
import type { Catalog } from './catalog'
import type { BuildSelection, Case, Category, Cooler, Cpu, Gpu, Memory, Motherboard, Part, Psu, ResolvedBuild } from './types'

export type Profile = 'gaming-1080p' | 'gaming-1440p' | 'workstation' | 'office'
export type PlatformPref = 'any' | 'am5' | 'am4' | 'intel'

export const MIN_BUDGET = 150_000
/**
 * GPU score a CPU can feed, as a multiple of its own score, when building from scratch.
 * Stricter than the advisor's estimate: a new build should not sit at the edge where the CPU
 * starts to hold back (1% lows, newer games). High-FPS e-sport leans on the CPU even more.
 */
const BUILD_CPU_CAP = { '1080p': 1.4, '1440p': 2 }
/** workstation: a card with a modern video encoder (RTX 3050 class and up) */
const MIN_WORKSTATION_GPU = 50
/** a case worth putting the parts in: share of the budget, capped */
const CASE_SHARE = 0.03
const CASE_FLOOR_MAX = 30_000
/** PSUs: 80+ certified; from this wattage 80+ Gold or better */
const GOLD_FROM_W = 650

/** among builds this close to the best score, the cheapest one wins */
const VALUE_TOLERANCE = 0.02

export interface AutoBuildOptions {
  budgetHuf: number
  profile: Profile
  /** also use estimated prices (foreign shops, similar parts); default: real Hungarian prices only */
  allowEstimates?: boolean
  platform?: PlatformPref
  /** parts to keep from the current build; only the empty slots are filled (their price counts) */
  keep?: BuildSelection
}

export type AutoBuildResult =
  | {
      ok: true
      selection: BuildSelection
      parts: Part[]
      totalHuf: number
      /** profile score (for comparing results, not shown as a unit) */
      score: number
      cpuScore?: number
      gpuScore?: number
      /** parts priced with an estimate */
      estimated: number
      notes: string[]
    }
  | { ok: false; reason: string }

interface ProfileSpec {
  label: string
  /** memory sizes to try, with how much each is worth to the profile (score multiplier) */
  ram: (budget: number) => { gb: number; bonus: number }[]
  /** minimum case price as a share of the budget */
  caseShare: number
  storageGb: (budget: number) => number
  /** GPU: required, none (integrated graphics), or allowed */
  gpu: 'required' | 'none'
  cpuMetric: (c: Cpu) => number
  gpuMetric: (g: Gpu) => number
  score: (cpu: number, gpu: number | undefined) => number
}

/** many-core work: the gaming score weighted by thread count (12 threads = Ryzen 5 7600) */
const multiCore = (c: Cpu) => (c.perfScore ?? 0) * Math.sqrt((c.threads ?? c.cores ?? 6) / 12)
/** NVIDIA is preferred for CUDA / NVENC in video and 3D software */
const isNvidia = (g: Gpu) => /geforce|rtx|quadro|^t\d{3,4}/i.test(g.chip ?? g.name)

export const PROFILES: Record<Profile, ProfileSpec> = {
  'gaming-1080p': {
    label: '1080p gaming / e-sport',
    ram: () => [{ gb: 16, bonus: 1 }, { gb: 32, bonus: 1.04 }],
    caseShare: CASE_SHARE,
    storageGb: (b) => (b < 300_000 ? 500 : 1000),
    gpu: 'required',
    cpuMetric: (c) => c.perfScore ?? 0,
    gpuMetric: (g) => g.perfScore ?? 0,
    score: (c, g) => Math.min(g ?? 0, BUILD_CPU_CAP['1080p'] * c),
  },
  'gaming-1440p': {
    label: '1440p / 4K gaming',
    ram: () => [{ gb: 16, bonus: 1 }, { gb: 32, bonus: 1.04 }],
    caseShare: CASE_SHARE,
    storageGb: (b) => (b >= 700_000 ? 2000 : 1000),
    gpu: 'required',
    cpuMetric: (c) => c.perfScore ?? 0,
    gpuMetric: (g) => g.perfScore ?? 0,
    // at higher resolutions the GPU runs out of breath first, so the CPU limit is further away
    score: (c, g) => Math.min(g ?? 0, BUILD_CPU_CAP['1440p'] * c),
  },
  workstation: {
    label: 'videóvágás / 3D / munka',
    ram: (b) => [{ gb: 32, bonus: 1 }, ...(b >= 700_000 ? [{ gb: 64, bonus: 1.06 }] : [])],
    caseShare: CASE_SHARE,
    storageGb: (b) => (b >= 400_000 ? 2000 : 1000),
    gpu: 'required',
    cpuMetric: multiCore,
    gpuMetric: (g) => ((g.perfScore ?? 0) >= MIN_WORKSTATION_GPU ? (g.perfScore ?? 0) * (isNvidia(g) ? 1 : 0.75) : 0),
    score: (c, g) => (g ? 0.6 * c + 0.4 * g : 0),
  },
  office: {
    label: 'irodai / általános használat',
    ram: () => [{ gb: 16, bonus: 1 }],
    caseShare: 0,
    storageGb: () => 500,
    gpu: 'none',
    cpuMetric: (c) => c.perfScore ?? 0,
    gpuMetric: () => 0,
    // beyond this, office work feels no faster: the cheaper and cooler the better
    score: (c) => Math.min(c, 70),
  },
}

const SOCKETS: Record<Exclude<PlatformPref, 'any'>, (s: string) => boolean> = {
  am5: (s) => s === 'AM5',
  am4: (s) => s === 'AM4',
  intel: (s) => s.startsWith('LGA'),
}

type Priced<T> = { part: T; price: number }

export function autoBuild(catalog: Catalog, opts: AutoBuildOptions): AutoBuildResult {
  const spec = PROFILES[opts.profile]
  const res = buildWith(catalog, opts, spec)
  // gaming on a small budget: integrated graphics rather than nothing
  if (!res.ok && spec.gpu === 'required' && opts.profile !== 'workstation' && !opts.keep?.gpu?.length) {
    const igpu: ProfileSpec = { ...spec, gpu: 'none', score: (c) => c }
    const alt = buildWith(catalog, opts, igpu)
    if (alt.ok)
      return {
        ...alt,
        notes: [
          'Ebből a keretből videókártyával nem jött ki teljes gép, ezért integrált grafikás processzorral raktuk össze: könnyebb és e-sport játékokra alacsony beállításon elég, később egy videókártyával bővíthető.',
          ...alt.notes,
        ],
      }
  }
  return res
}

function buildWith(catalog: Catalog, opts: AutoBuildOptions, spec: ProfileSpec): AutoBuildResult {
  const budget = opts.budgetHuf
  if (!(budget > 0)) return { ok: false, reason: 'Adj meg egy költségkeretet.' }
  const priceOf = (p: Part) => (opts.allowEstimates ? effectivePrice(p) : p.price?.medianHuf)
  const priced = <T extends Part>(list: T[], test: (p: T) => boolean = () => true): Priced<T>[] =>
    list
      .filter(test)
      .map((part) => ({ part, price: priceOf(part)! }))
      .filter((x) => x.price !== undefined)
      .sort((a, b) => a.price - b.price)

  // ---- kept parts
  const kept = catalog.resolveBuild(opts.keep ?? {})
  const keptPrice = (p?: Part) => (p ? (priceOf(p) ?? 0) : 0)
  const fixed = <T extends Part>(p: T | undefined): Priced<T>[] | undefined => (p ? [{ part: p, price: keptPrice(p) }] : undefined)
  const keptUnpriced = [kept.cpu, kept.motherboard, kept.gpu, kept.psu, kept.case, kept.cooler, ...kept.memory, ...kept.storage].filter(
    (p): p is Part => !!p && priceOf(p) === undefined,
  )

  // ---- processor and graphics card candidates (price/performance frontier)
  const platformOk = (c: Cpu) => (!opts.platform || opts.platform === 'any' ? true : SOCKETS[opts.platform](c.socket))
  const cpuList =
    fixed(kept.cpu) ??
    frontier(
      priced(catalog.data.cpu, (c) =>
        c.perfScore !== undefined &&
        platformOk(c) &&
        (!kept.motherboard || c.socket === kept.motherboard.socket) &&
        (spec.gpu !== 'none' || !!c.integratedGraphics || !!kept.gpu),
      ),
      spec.cpuMetric,
    )
  const gpuList: (Priced<Gpu> | null)[] = kept.gpu
    ? fixed(kept.gpu)!
    : spec.gpu === 'none'
      ? [null]
      : frontier(priced(catalog.data.gpu, (g) => g.perfScore !== undefined && spec.gpuMetric(g) > 0), spec.gpuMetric)

  // ---- the rest, cheapest that fits
  const boards = priced(catalog.data.motherboard, (m) => m.formFactor === 'ATX' || m.formFactor === 'mATX')
  const ramOptions = spec.ram(budget)
  const kitsBySize = new Map(ramOptions.map((o) => [o.gb, priced(catalog.data.memory, (m) => m.modules === 2 && m.moduleSizeGb * 2 === o.gb)]))
  const coolers = priced(catalog.data.cooler, (c) => c.type === 'air')
  const caseFloor = Math.min(budget * spec.caseShare, CASE_FLOOR_MAX)
  const cases = priced(catalog.data.case).filter((x) => x.price >= caseFloor)
  const psus = priced(catalog.data.psu, (p) => p.formFactor === 'ATX' && /^80\+ (Bronze|Silver|Gold|Platinum|Titanium)$/.test(p.efficiency ?? ''))
  const goodEnough = (p: Psu, need: number) => need < GOLD_FROM_W || /Gold|Platinum|Titanium/.test(p.efficiency ?? '')
  const targetGb = spec.storageGb(budget)
  const ssd =
    kept.storage.length > 0
      ? null
      : (priced(catalog.data.storage, (s) => s.kind === 'SSD' && s.interface === 'M.2 NVMe' && s.capacityGb >= targetGb && s.capacityGb < targetGb * 2)[0] ??
        priced(catalog.data.storage, (s) => s.kind === 'SSD' && s.capacityGb >= targetGb)[0])
  if (ssd === undefined) return { ok: false, reason: 'Nincs megfelelő SSD árral az adatbázisban.' }
  const storageCost = ssd ? ssd.price : kept.storage.reduce((s, p) => s + keptPrice(p), 0)

  /** board + memory + cooler for a CPU: the cheapest valid set */
  const platformFor = (c: Cpu, kits: Priced<Memory>[]) => {
    let best: { board: Priced<Motherboard>; ram: Priced<Memory> | null; cooler: Priced<Cooler>; price: number } | undefined
    const coolerP =
      fixed(kept.cooler)?.[0] ??
      coolers.find((x) => x.part.sockets.includes(c.socket) && ((c.tdpW ?? 65) <= 65 || (x.part.heightMm ?? 0) >= 150))
    if (!coolerP) return undefined
    const boardList = fixed(kept.motherboard) ?? boards.filter((b) => b.part.socket === c.socket && !(isStrongCpu(c) && ENTRY_CHIPSET.test(b.part.chipset ?? '')))
    for (const mt of c.memoryTypes?.length ? c.memoryTypes : ['DDR4', 'DDR5']) {
      // a board that runs this CPU out of the box, if there is one; else one that may need a BIOS update
      const needsBios = (b: Priced<Motherboard>) => !!c.biosUpdateChipsets?.includes(b.part.chipset ?? '')
      const board =
        boardList.find((b) => b.part.memoryType === mt && !needsBios(b)) ?? boardList.find((b) => b.part.memoryType === mt)
      if (!board) continue
      const ram = kept.memory.length ? null : kits.find((k) => k.part.memoryType === mt)
      if (ram === undefined) continue
      const price = board.price + (ram?.price ?? kept.memory.reduce((s, p) => s + keptPrice(p), 0)) + coolerP.price
      if (!best || price < best.price) best = { board, ram, cooler: coolerP, price }
    }
    return best
  }

  type Candidate = { score: number; price: number; parts: Priced<Part>[]; cpu: Cpu; gpu: Gpu | null }
  const results: Candidate[] = []
  // with kept memory there is nothing to choose
  for (const ramOpt of kept.memory.length ? [{ gb: 0, bonus: 1 }] : ramOptions)
  for (const c of cpuList) {
    const plat = platformFor(c.part, kitsBySize.get(ramOpt.gb) ?? [])
    if (!plat) continue
    for (const g of gpuList) {
      const caseP =
        fixed(kept.case)?.[0] ??
        cases.find((x) => fitsCase(x.part, plat.board.part, g?.part ?? null, plat.cooler.part))
      if (!caseP) continue
      const draft: ResolvedBuild = {
        cpu: c.part,
        motherboard: plat.board.part,
        memory: plat.ram ? [plat.ram.part] : kept.memory,
        gpu: g?.part ?? undefined,
        storage: ssd ? [ssd.part] : kept.storage,
        psu: undefined,
        case: caseP.part,
        cooler: plat.cooler.part,
      }
      const need = estimatePower(draft).recommendedW
      const psuP = fixed(kept.psu)?.[0] ?? psus.find((x) => x.part.wattage >= need && goodEnough(x.part, need) && psuFits(x.part, g?.part ?? null, caseP.part))
      if (!psuP) continue
      const price = c.price + plat.price + (g?.price ?? 0) + caseP.price + psuP.price + storageCost
      if (price > budget) continue
      const gm = g ? spec.gpuMetric(g.part) : undefined
      results.push({
        score: spec.score(spec.cpuMetric(c.part), gm) * ramOpt.bonus,
        price,
        cpu: c.part,
        gpu: g?.part ?? null,
        parts: [c, plat.board, ...(plat.ram ? [plat.ram] : []), plat.cooler, ...(g ? [g] : []), ...(ssd ? [ssd] : []), caseP, psuP],
      })
    }
  }

  if (results.length === 0) {
    if (budget < MIN_BUDGET) return { ok: false, reason: `${fmt(MIN_BUDGET)} alatt új alkatrészekből nem rakható össze teljes gép.` }
    return {
      ok: false,
      reason:
        spec.gpu === 'required'
          ? 'Ebből a keretből nem jött ki teljes gép videókártyával. Emeld a keretet, engedélyezd a becsült árakat, vagy válassz másik platformot.'
          : 'Ebből a keretből nem jött ki teljes gép. Emeld a keretet vagy engedélyezd a becsült árakat.',
    }
  }

  // best score, then the cheapest close to it; each checked with the full rules
  const best = Math.max(...results.map((r) => r.score))
  const ordered = results.sort((a, b) => {
    const aClose = a.score >= best * (1 - VALUE_TOLERANCE)
    const bClose = b.score >= best * (1 - VALUE_TOLERANCE)
    if (aClose !== bClose) return aClose ? -1 : 1
    return aClose ? a.price - b.price : b.score - a.score
  })
  for (const r of ordered.slice(0, 200)) {
    const selection = toSelection(opts.keep ?? {}, r.parts.map((x) => x.part))
    const errors = checkBuild(catalog.resolveBuild(selection)).filter((e) => e.level === 'error')
    if (errors.length) continue
    const parts = buildPartsOf(catalog, selection)
    const estimated = parts.filter((p) => !p.price && p.estimate).length
    return {
      ok: true,
      selection,
      parts,
      totalHuf: r.price,
      score: r.score,
      cpuScore: r.cpu.perfScore,
      gpuScore: r.gpu?.perfScore,
      estimated,
      notes: notesFor(opts, r, budget, estimated, keptUnpriced),
    }
  }
  return { ok: false, reason: 'A jelöltek egyike sem ment át a kompatibilitás-ellenőrzésen.' }
}

/** Price/performance frontier by a metric (cheapest first): only parts that beat every cheaper one. */
function frontier<T extends Part>(list: Priced<T>[], metric: (p: T) => number): Priced<T>[] {
  const out: Priced<T>[] = []
  let top = -Infinity
  for (const x of list) {
    const m = metric(x.part)
    if (m > top) {
      out.push(x)
      top = m
    }
  }
  return out
}

function fitsCase(c: Case, board: Motherboard, gpu: Gpu | null, cooler: Cooler): boolean {
  if (!c.supportedBoards.includes(board.formFactor)) return false
  if (gpu) {
    if (gpu.lengthMm === undefined || c.maxGpuLengthMm === undefined) return false // unknown fit: don't guess
    if (gpu.lengthMm > c.maxGpuLengthMm) return false
  }
  // only cases whose cooler limit we know, so the result has no "can't check" item
  if (cooler.heightMm !== undefined && (c.maxCoolerHeightMm === undefined || cooler.heightMm > c.maxCoolerHeightMm)) return false
  // the PSU size must be known (and ATX)
  if (!c.psuFormFactors?.length || !c.psuFormFactors.includes('ATX')) return false
  return true
}

function psuFits(p: Psu, gpu: Gpu | null, c: Case): boolean {
  if (c.psuFormFactors?.length && !c.psuFormFactors.includes(p.formFactor)) return false
  if (!gpu?.powerConnectors) return true
  if (!p.connectors) return false // a card that needs power cables: only PSUs whose cables we know
  return (gpu.powerConnectors['12V-2x6'] ?? 0) <= (p.connectors['12V-2x6'] ?? 0) && (gpu.powerConnectors['8pin'] ?? 0) <= (p.connectors['8pin'] ?? 0)
}

function toSelection(keep: BuildSelection, parts: Part[]): BuildSelection {
  const sel: BuildSelection = { ...keep }
  const byCat = new Map<Category, string[]>()
  for (const p of parts) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p.id])
  for (const [cat, ids] of byCat) if (!keep[cat]?.length) sel[cat] = ids
  return sel
}

function buildPartsOf(catalog: Catalog, sel: BuildSelection): Part[] {
  const b = catalog.resolveBuild(sel)
  return [b.cpu, b.motherboard, ...b.memory, b.cooler, b.gpu, ...b.storage, b.case, b.psu].filter((p): p is Part => !!p)
}

const fmt = (n: number) => `${n.toLocaleString('hu-HU')} Ft`

function notesFor(
  opts: AutoBuildOptions,
  r: { price: number; gpu: Gpu | null },
  budget: number,
  estimated: number,
  keptUnpriced: Part[],
): string[] {
  const notes: string[] = []
  if (budget < MIN_BUDGET) notes.push(`${fmt(MIN_BUDGET)} alatti keretből csak nagyon alap gép jön ki.`)
  if (opts.profile === 'office') {
    notes.push('Integrált grafikájú processzor, külön videókártya nélkül: csendesebb és kevesebbet fogyaszt.')
  }
  if (opts.profile === 'workstation' && r.gpu && isNvidia(r.gpu)) notes.push('NVIDIA videókártya a CUDA / NVENC támogatás miatt (vágó- és 3D-programok).')
  const left = budget - r.price
  if (left > budget * 0.1)
    notes.push(
      opts.profile === 'office'
        ? `${fmt(left)} marad a keretből: irodai munkára egy erősebb gép nem lenne érezhetően gyorsabb.`
        : `${fmt(left)} marad a keretből: a drágább lehetőségek már alig adnának többet.`,
    )
  if (estimated > 0) notes.push(`${estimated} alkatrész becsült áron szerepel – a valódi ár eltérhet.`)
  if (keptUnpriced.length) notes.push(`${keptUnpriced.length} megtartott alkatrésznek nincs ára, azt 0 Ft-tal számoltuk.`)
  return notes
}
