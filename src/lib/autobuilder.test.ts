import { describe, expect, it } from 'vitest'
import { fixtureCatalog } from '../test/fixtureCatalog'
import { autoBuild, MIN_BUDGET, type AutoBuildResult, type Profile } from './autobuilder'
import { checkBuild } from './compat'
import type { Cpu, Gpu, Part } from './types'

const ok = (r: AutoBuildResult) => {
  if (!r.ok) throw new Error(r.reason)
  return r
}
const sum = (parts: Part[]) => parts.reduce((s, p) => s + (p.price?.medianHuf ?? 0), 0)
const cpuOf = (parts: Part[]) => parts.find((p) => p.category === 'cpu') as Cpu
const gpuOf = (parts: Part[]) => parts.find((p) => p.category === 'gpu') as Gpu | undefined

describe('autoBuild', () => {
  const profiles: Profile[] = ['gaming-1080p', 'gaming-1440p', 'workstation', 'office']

  it.each(profiles)('%s: a complete, compatible build within the budget', (profile) => {
    const r = ok(autoBuild(fixtureCatalog, { budgetHuf: 900_000, profile }))
    const cats = new Set(r.parts.map((p) => p.category))
    for (const c of ['cpu', 'motherboard', 'memory', 'storage', 'psu', 'case', 'cooler']) expect(cats).toContain(c)
    expect(r.totalHuf).toBeLessThanOrEqual(900_000)
    expect(r.totalHuf).toBe(sum(r.parts))
    expect(checkBuild(fixtureCatalog.resolveBuild(r.selection)).filter((e) => e.level === 'error')).toEqual([])
  })

  it('more money → at least as fast', () => {
    const scores = [400_000, 600_000, 900_000, 1_400_000].map((b) => ok(autoBuild(fixtureCatalog, { budgetHuf: b, profile: 'gaming-1440p' })).score)
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
  })

  it('gaming builds keep the CPU and GPU in balance', () => {
    const r = ok(autoBuild(fixtureCatalog, { budgetHuf: 1_400_000, profile: 'gaming-1080p' }))
    expect(gpuOf(r.parts)!.perfScore!).toBeLessThanOrEqual(1.4 * cpuOf(r.parts).perfScore! * 1.25)
  })

  it('office: integrated graphics, no card, and it does not spend money for nothing', () => {
    const r = ok(autoBuild(fixtureCatalog, { budgetHuf: 1_000_000, profile: 'office' }))
    expect(gpuOf(r.parts)).toBeUndefined()
    expect(cpuOf(r.parts).integratedGraphics).toBe(true)
    expect(r.totalHuf).toBeLessThan(500_000)
    expect(r.notes.join(' ')).toMatch(/marad a keretből/)
  })

  it('workstation: at least 32 GB, NVIDIA preferred, a real graphics card', () => {
    const r = ok(autoBuild(fixtureCatalog, { budgetHuf: 1_000_000, profile: 'workstation' }))
    const ram = r.parts.filter((p) => p.category === 'memory').reduce((s, m) => s + (m as { modules: number; moduleSizeGb: number }).modules * (m as { moduleSizeGb: number }).moduleSizeGb, 0)
    expect(ram).toBeGreaterThanOrEqual(32)
    const g = gpuOf(r.parts)!
    expect(g.perfScore!).toBeGreaterThanOrEqual(50)
    expect(g.chip).toMatch(/RTX/)
  })

  it('platform preference is respected', () => {
    expect(cpuOf(ok(autoBuild(fixtureCatalog, { budgetHuf: 800_000, profile: 'gaming-1080p', platform: 'am4' })).parts).socket).toBe('AM4')
    expect(cpuOf(ok(autoBuild(fixtureCatalog, { budgetHuf: 800_000, profile: 'gaming-1080p', platform: 'intel' })).parts).socket).toMatch(/^LGA/)
    expect(cpuOf(ok(autoBuild(fixtureCatalog, { budgetHuf: 800_000, profile: 'gaming-1080p', platform: 'am5' })).parts).socket).toBe('AM5')
  })

  it('kept parts stay and their price counts against the budget', () => {
    const keep = { gpu: ['gpu-asus-5070ti-tuf'], case: ['case-fractal-north'] }
    const r = ok(autoBuild(fixtureCatalog, { budgetHuf: 900_000, profile: 'gaming-1440p', keep }))
    expect(r.selection.gpu).toEqual(keep.gpu)
    expect(r.selection.case).toEqual(keep.case)
    expect(r.totalHuf).toBeLessThanOrEqual(900_000)
    expect(r.totalHuf).toBe(sum(r.parts))
  })

  it('a kept board fixes the socket', () => {
    const r = ok(autoBuild(fixtureCatalog, { budgetHuf: 700_000, profile: 'gaming-1080p', keep: { motherboard: ['mb-msi-b550-tomahawk'] } }))
    expect(cpuOf(r.parts).socket).toBe('AM4')
  })

  it('too small a budget says so instead of building nonsense', () => {
    const r = autoBuild(fixtureCatalog, { budgetHuf: 50_000, profile: 'gaming-1080p' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(String(MIN_BUDGET.toLocaleString('hu-HU')))
  })

  it('gaming on a tight budget falls back to integrated graphics, with a note', () => {
    // somewhere between "nothing fits" and "a card fits" there is room for an iGPU build only
    let fallbacks = 0
    for (let b = 150_000; b <= 500_000; b += 10_000) {
      const r = autoBuild(fixtureCatalog, { budgetHuf: b, profile: 'gaming-1080p' })
      if (!r.ok || gpuOf(r.parts)) continue
      fallbacks++
      expect(cpuOf(r.parts).integratedGraphics).toBe(true)
      expect(r.notes[0]).toMatch(/integrált grafik/)
    }
    expect(fallbacks).toBeGreaterThan(0)
  })
})

describe('autoBuild without a budget', () => {
  it('builds the strongest worthwhile machine, at least as fast as any budget', () => {
    const free = ok(autoBuild(fixtureCatalog, { profile: 'gaming-1440p' }))
    const capped = ok(autoBuild(fixtureCatalog, { budgetHuf: 1_400_000, profile: 'gaming-1440p' }))
    expect(free.score).toBeGreaterThanOrEqual(capped.score)
    expect(checkBuild(fixtureCatalog.resolveBuild(free.selection)).filter((e) => e.level === 'error')).toEqual([])
    expect(free.notes.join(' ')).toMatch(/Keret nélkül/)
    expect(free.notes.join(' ')).not.toMatch(/Infinity|marad a keretből/)
  })
  it('office stays modest even without a budget', () => {
    const r = ok(autoBuild(fixtureCatalog, { profile: 'office' }))
    expect(r.totalHuf).toBeLessThan(500_000)
  })
})
