import { describe, expect, it } from 'vitest'
import { fixtureCatalog } from '../test/fixtureCatalog'
import { buildPlan } from './plan'
import { adviseUpgrades, GENERAL_MODEL, partsOf, type Suggestion } from './upgrade'
import type { BuildSelection } from './types'

const am4: BuildSelection = {
  cpu: ['cpu-r5-5600'],
  motherboard: ['mb-gb-b550m-ds3h'],
  memory: ['ram-cor-ddr4-2x16-3600'],
  gpu: ['gpu-asrock-7600-cl'],
  psu: ['psu-cor-cx550'],
  case: ['case-cm-q300l'],
  cooler: ['cool-dc-le520'],
}

/** a platform + GPU bundle, built by hand so the test does not depend on what the advisor picks */
const bundle = (cpu: string, board: string, extra: string[], gpu?: string): Suggestion => ({
  part: fixtureCatalog.getPart(cpu)!,
  also: [board, ...extra, ...(gpu ? [gpu] : [])].map((id) => fixtureCatalog.getPart(id)!),
  priceHuf: 0,
  score: 0,
  gain: 0,
  needsPsu: false,
})

describe('buildPlan', () => {
  const toAm5 = bundle('cpu-r7-7800x3d', 'mb-gb-b650m-ds3h', ['ram-cor-ddr5-2x16-6000'], 'gpu-msi-5080-gaming')
  const plan = buildPlan(fixtureCatalog, am4, toAm5, GENERAL_MODEL)

  it('CPU, board and the new memory type are one step; the GPU is its own', () => {
    const platform = plan.steps.find((s) => s.kind === 'platform')!
    expect(platform.parts.map((p) => p.category).sort()).toEqual(['cpu', 'memory', 'motherboard'])
    expect(platform.why).toMatch(/csak együtt/)
    expect(platform.why).toMatch(/DDR5/)
    expect(plan.steps.find((s) => s.kind === 'gpu')!.parts.map((p) => p.id)).toEqual(['gpu-msi-5080-gaming'])
  })

  it('a weak PSU gets its own step before the step that needs it', () => {
    const kinds = plan.steps.map((s) => s.kind)
    expect(kinds).toContain('psu')
    const psuAt = kinds.indexOf('psu')
    const psu = plan.steps[psuAt].parts[0] as { wattage: number }
    expect(psu.wattage).toBeGreaterThan(550)
    // the step right after it is the one that needed the power
    expect(psuAt).toBeLessThan(kinds.length - 1)
  })

  it('every part of the bundle is bought exactly once; totals add up', () => {
    const bought = plan.steps.flatMap((s) => s.parts.map((p) => p.id)).filter((id) => !id.startsWith('psu-'))
    expect(bought.sort()).toEqual(partsOf(toAm5).map((p) => p.id).sort())
    expect(plan.totalHuf).toBe(plan.steps.reduce((t, s) => t + s.priceHuf, 0))
  })

  it('performance never drops along the way and ends at the full upgrade', () => {
    const scores = plan.steps.map((s) => s.score!)
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
    expect(scores[scores.length - 1]).toBe(Math.min(262, 2 * 135))
  })

  it('kept memory and cooler are not bought again', () => {
    const lga = bundle('cpu-i5-14600k', 'mb-msi-b760-p-ddr4', ['cool-bq-purerock3'])
    const p = buildPlan(fixtureCatalog, am4, lga, GENERAL_MODEL)
    expect(p.steps).toHaveLength(1)
    expect(p.steps[0].parts.map((x) => x.category).sort()).toEqual(['cooler', 'cpu', 'motherboard'])
    expect(p.steps[0].why).toMatch(/hűtő/)
    expect(p.steps[0].why).not.toMatch(/memóri/)
  })

  it('works for what the advisor actually suggests', () => {
    const a = adviseUpgrades(fixtureCatalog, { ...am4, gpu: ['gpu-msi-4060-ventus2x'] })
    for (const s of [...a.platform, ...a.platformGpu]) {
      const p = buildPlan(fixtureCatalog, am4, s, GENERAL_MODEL)
      expect(p.steps.length).toBeGreaterThan(0)
      expect(p.steps.some((x) => x.kind === 'platform')).toBe(true)
    }
  })
})
