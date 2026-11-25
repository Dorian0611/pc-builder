import { describe, expect, it } from 'vitest'
import { fixtureCatalog } from '../test/fixtureCatalog'
import { cpuPerfScore, gpuPerfScore } from '../../scripts/perf.mjs'
import { adviseUpgrades, applySuggestion, balance, CPU_CAP, frontier, gamingScore, partsOf, pickSpread, withReplaced, type PerfModel, type Suggestion } from './upgrade'
import { checkBuild } from './compat'
import type { BuildSelection, Part } from './types'

const resolve = (sel: BuildSelection) => fixtureCatalog.resolveBuild(sel)
const ids = (list: Suggestion[]) => list.map((s) => s.part.id)

describe('performance scores', () => {
  const cpu = (arch: string, boost: number, cores: number, threads: number, l3 = 32, eff = 0) => ({
    microarchitecture: arch,
    clocks: { performance: { base: boost - 1, boost } },
    cores: { total: cores + eff, performance: eff ? cores : 0, efficiency: eff, threads },
    cache: { l3 },
  })
  it('the Ryzen 5 7600 is the 100 reference', () => {
    expect(cpuPerfScore(cpu('Zen 4', 5.1, 6, 12))).toBe(100)
  })
  it('3D V-Cache and more cores score higher, old architectures lower', () => {
    expect(cpuPerfScore(cpu('Zen 4', 5.0, 8, 16, 96))).toBeGreaterThan(115)
    expect(cpuPerfScore(cpu('Zen 2', 4.2, 6, 12))).toBeLessThan(70)
  })
  it('dual-die X3D parts score like the 8-core one (games run on the cache die)', () => {
    const big = cpuPerfScore(cpu('Zen 5', 5.7, 16, 32, 128))!
    const eight = cpuPerfScore(cpu('Zen 5', 5.2, 8, 16, 96))!
    expect(Math.abs(big - eight)).toBeLessThanOrEqual(3)
  })
  it('Intel hybrid: P-cores count, E-cores add a little', () => {
    const hybrid = cpuPerfScore(cpu('Raptor Lake Refresh', 5.3, 6, 20, 24, 8))!
    expect(hybrid).toBeGreaterThan(95)
    expect(hybrid).toBeLessThan(110)
  })
  it('no turbo → base clock; unknown architecture → no score', () => {
    expect(cpuPerfScore({ microarchitecture: 'Coffee Lake', clocks: { performance: { base: 3.7, boost: 0 } }, cores: { total: 2, threads: 2 } })).toBeGreaterThan(0)
    expect(cpuPerfScore(cpu('NetBurst', 3.8, 1, 2))).toBeUndefined()
  })
  it('GPU table: RTX 4060 = 100, workstation cards have no score', () => {
    expect(gpuPerfScore('GeForce RTX 4060')).toBe(100)
    expect(gpuPerfScore('GeForce RTX 5090')).toBeGreaterThan(gpuPerfScore('GeForce RTX 5080')!)
    expect(gpuPerfScore('Quadro P4000')).toBeUndefined()
  })
})

describe('balance', () => {
  it('the CPU caps what a GPU can deliver', () => {
    expect(gamingScore(100, 150)).toBe(150)
    expect(gamingScore(100, 300)).toBe(CPU_CAP * 100)
    expect(gamingScore(undefined, 120)).toBe(120)
  })
  it('names the part holding the build back', () => {
    expect(balance(resolve({ cpu: ['cpu-r5-5600'], gpu: ['gpu-msi-5080-gaming'] })).limiter).toBe('cpu')
    expect(balance(resolve({ cpu: ['cpu-r7-7800x3d'], gpu: ['gpu-asrock-7600-cl'] })).limiter).toBe('gpu')
    expect(balance(resolve({ cpu: ['cpu-r5-7600'], gpu: ['gpu-gb-5070-windforce'] })).limiter).toBe('balanced')
  })
})

describe('frontier and spread', () => {
  // current build scores 10
  const s = (id: string, priceHuf: number, score: number): Suggestion => ({ part: { id } as Part, priceHuf, score, gain: score / 10 - 1, needsPsu: false })
  it('drops parts that a cheaper one beats', () => {
    expect(ids(frontier([s('a', 100, 10), s('b', 200, 8), s('c', 300, 20)]))).toEqual(['c', 'a'])
  })
  it('picks the strongest, the best value and the cheapest', () => {
    const f = frontier([s('a', 100, 10), s('b', 150, 30), s('c', 300, 35), s('d', 400, 40)])
    expect(ids(pickSpread(f))).toEqual(['d', 'b', 'a'])
  })
})

describe('adviseUpgrades', () => {
  const old: BuildSelection = {
    cpu: ['cpu-r5-7600'],
    motherboard: ['mb-msi-b650-gaming-plus'],
    memory: ['ram-kf-ddr5-2x8-5600'],
    gpu: ['gpu-asrock-7600-cl'],
    storage: ['hdd-sea-barracuda-2tb'],
    psu: ['psu-cor-cx550'],
    case: ['case-cor-3000d'],
  }

  it('suggests faster graphics cards with their gain, best first', () => {
    const a = adviseUpgrades(fixtureCatalog, old)
    expect(a.balance.limiter).toBe('gpu')
    expect(a.gpu.length).toBeGreaterThan(0)
    for (const g of a.gpu) expect(g.gain!).toBeGreaterThanOrEqual(0.1)
    expect(a.gpu[0].score).toBeGreaterThanOrEqual(a.gpu[a.gpu.length - 1].score)
    // a big card on a 550 W PSU: suggested, but flagged
    expect(a.gpu.find((g) => g.part.id === 'gpu-msi-5080-gaming')?.needsPsu ?? true).toBe(true)
  })

  it('respects the budget', () => {
    for (const g of adviseUpgrades(fixtureCatalog, old, 200_000).gpu) expect(g.priceHuf).toBeLessThanOrEqual(200_000)
  })

  it('CPU suggestions stay on the board socket', () => {
    const a = adviseUpgrades(fixtureCatalog, { ...old, gpu: ['gpu-msi-5080-gaming'], psu: ['psu-msi-a1000gl'] })
    expect(a.balance.limiter).toBe('cpu')
    expect(a.cpu.length).toBeGreaterThan(0)
    for (const c of a.cpu) expect((c.part as { socket: string }).socket).toBe('AM5')
  })

  it('flags too little RAM and a build without SSD', () => {
    const reasons = adviseUpgrades(fixtureCatalog, old).other.map((o) => o.suggestion.part.category)
    expect(reasons).toContain('memory')
    expect(reasons).toContain('storage')
  })

  it('suggests CPU + GPU together when both hold the build back', () => {
    // AM4 Ryzen 5 5600 + RX 7600 in a heavy game: either swap alone soon hits the other
    const am4 = {
      cpu: ['cpu-r5-5600'],
      motherboard: ['mb-msi-b550-tomahawk'],
      gpu: ['gpu-asrock-7600-cl'],
      psu: ['psu-msi-a1000gl'],
    }
    const model: PerfModel = { score: (c, g) => (g === undefined ? undefined : Math.min(g, (c ?? Infinity) * 1.3)), limiter: () => 'balanced' }
    const a = adviseUpgrades(fixtureCatalog, am4, undefined, model)
    expect(a.combo.length).toBeGreaterThan(0)
    const best = Math.max(...a.gpu.map((s) => s.score), ...a.cpu.map((s) => s.score))
    for (const s of a.combo) {
      expect(s.part.category).toBe('cpu')
      expect(s.also?.[0].category).toBe('gpu')
      expect(s.score).toBeGreaterThanOrEqual(best * 1.1)
      expect(s.priceHuf).toBe((s.part.price?.medianHuf ?? 0) + (s.also![0].price?.medianHuf ?? 0))
      expect((s.part as { socket: string }).socket).toBe('AM4')
    }
  })

  it('no combo when one swap already does the job', () => {
    // fast CPU, slow GPU: a new GPU alone is the answer
    const a = adviseUpgrades(fixtureCatalog, { ...old, cpu: ['cpu-r7-7800x3d'], psu: ['psu-msi-a1000gl'] })
    expect(a.combo).toEqual([])
  })

  it('combos respect the budget as a total', () => {
    const am4 = { cpu: ['cpu-r5-5600'], motherboard: ['mb-msi-b550-tomahawk'], gpu: ['gpu-asrock-7600-cl'], psu: ['psu-msi-a1000gl'] }
    const model: PerfModel = { score: (c, g) => (g === undefined ? undefined : Math.min(g, (c ?? Infinity) * 1.3)), limiter: () => 'balanced' }
    for (const s of adviseUpgrades(fixtureCatalog, am4, 250_000, model).combo) expect(s.priceHuf).toBeLessThanOrEqual(250_000)
  })

  it('a suggestion replaces the whole category', () => {
    const kit = fixtureCatalog.getPart('ram-cor-ddr5-2x16-6000')!
    expect(withReplaced({ memory: ['a', 'b'], cpu: ['c'] }, kit)).toEqual({ memory: [kit.id], cpu: ['c'] })
  })
})

describe('CPU limit margin', () => {
  it('a GPU only slightly above what the CPU can feed is not called CPU-bound', () => {
    // 5600 = 78 → feeds up to 156; RTX 5070 = 175 is >10% above, RX 9060 XT-level 160 would not be
    expect(balance(resolve({ cpu: ['cpu-r5-5600'], gpu: ['gpu-gb-5070-windforce'] })).limiter).toBe('cpu')
    expect(balance(resolve({ cpu: ['cpu-r7-5700x3d'], gpu: ['gpu-gb-5070-windforce'] })).limiter).toBe('balanced')
  })
  it('knows whether a faster CPU fits the board at all', () => {
    const am4 = { cpu: ['cpu-r7-5700x3d'], motherboard: ['mb-msi-b550-tomahawk'], gpu: ['gpu-msi-5080-gaming'] }
    expect(adviseUpgrades(fixtureCatalog, am4).fasterCpuFits).toBe(false)
    expect(adviseUpgrades(fixtureCatalog, { ...am4, cpu: ['cpu-r5-5600'] }).fasterCpuFits).toBe(true)
  })
})

describe('platform change', () => {
  const am4: BuildSelection = {
    cpu: ['cpu-r5-5600'],
    motherboard: ['mb-gb-b550m-ds3h'],
    memory: ['ram-cor-ddr4-2x16-3600'],
    gpu: ['gpu-msi-5080-gaming'],
    psu: ['psu-msi-a1000gl'],
    case: ['case-cm-q300l'], // mATX/ITX only
    cooler: ['cool-dc-le520'], // no LGA 1851
  }
  const advice = adviseUpgrades(fixtureCatalog, am4)
  const all = [...advice.platform, ...advice.platformGpu]

  it('a CPU-bound AM4 build gets new-platform bundles', () => {
    expect(advice.balance.limiter).toBe('cpu')
    expect(advice.platform.length).toBeGreaterThan(0)
  })

  it('each bundle: CPU on another socket with a matching board that fits the case', () => {
    for (const s of all) {
      const cpu = s.part as { socket: string }
      expect(cpu.socket).not.toBe('AM4')
      const board = s.also!.find((p) => p.category === 'motherboard') as { socket: string; formFactor: string; memoryType: string }
      expect(board.socket).toBe(cpu.socket)
      expect(['mATX', 'ITX']).toContain(board.formFactor)
    }
  })

  it('memory: kept when the type stays, a new kit of the right type otherwise', () => {
    for (const s of all) {
      const board = s.also!.find((p) => p.category === 'motherboard') as { memoryType: string }
      const kit = s.also!.find((p) => p.category === 'memory') as { memoryType: string } | undefined
      if (board.memoryType === 'DDR4') {
        expect(kit).toBeUndefined()
        expect(s.keeps).toContain('memory')
      } else expect(kit?.memoryType).toBe(board.memoryType)
    }
  })

  it('cooler: replaced only when the old one lacks the socket', () => {
    for (const s of all) {
      const socket = (s.part as { socket: string }).socket
      const cooler = s.also!.find((p) => p.category === 'cooler') as { sockets: string[] } | undefined
      if (socket === 'LGA 1851') expect(cooler?.sockets).toContain('LGA 1851')
      else expect(s.keeps).toContain('cooler')
    }
  })

  it('the price is the whole bundle and the result is a valid build', () => {
    for (const s of all) {
      expect(s.priceHuf).toBe(partsOf(s).reduce((sum, p) => sum + (p.price?.medianHuf ?? 0), 0))
      const errors = checkBuild(fixtureCatalog.resolveBuild(applySuggestion(am4, s))).filter((e) => e.level === 'error' && !e.rule.startsWith('psu'))
      expect(errors).toEqual([])
    }
  })

  it('respects the budget and stays quiet when the current platform is enough', () => {
    for (const s of adviseUpgrades(fixtureCatalog, am4, 200_000).platform) expect(s.priceHuf).toBeLessThanOrEqual(200_000)
    const fast = adviseUpgrades(fixtureCatalog, { ...am4, cpu: ['cpu-r7-5700x3d'], gpu: ['gpu-asrock-7600-cl'] })
    expect(fast.platform).toEqual([])
  })
})
