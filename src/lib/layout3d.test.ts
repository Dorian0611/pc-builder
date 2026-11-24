import { describe, expect, it } from 'vitest'
import { fixtureCatalog } from '../test/fixtureCatalog'
import { layoutBuild } from './layout3d'
import type { BuildSelection } from './types'

const build = (sel: BuildSelection) => fixtureCatalog.resolveBuild(sel)
const items = (sel: BuildSelection) => layoutBuild(build(sel)).items
const kinds = (sel: BuildSelection) => items(sel).map((s) => s.kind)
const find = (sel: BuildSelection, key: string) => items(sel).find((s) => s.key === key)!

describe('layoutBuild', () => {
  it('an empty build has no items', () => {
    expect(items({})).toEqual([])
  })

  it('shows only what is in the build', () => {
    expect(kinds({ gpu: ['gpu-msi-4060-ventus2x'] })).toEqual(['gpu'])
    expect(kinds({ cpu: ['cpu-r5-7600'] })).toEqual(['cpu'])
  })

  it('uses the real GPU length, and longer cards get three fans', () => {
    const g = find({ gpu: ['gpu-asus-5070ti-tuf'] }, 'gpu')
    expect(g.size[2]).toBe(348)
    expect(g.fans).toBe(3)
    expect(find({ gpu: ['gpu-msi-4060-ventus2x'] }, 'gpu').fans).toBe(2)
  })

  it('one RAM stick per module, capped by the board slots', () => {
    const sel = { motherboard: ['mb-asus-b650e-i'], memory: ['ram-kf-ddr5-2x16-6000', 'ram-kf-ddr5-2x16-6000'] }
    expect(kinds(sel).filter((k) => k === 'ram')).toHaveLength(2) // ITX: 2 slots
  })

  it('the board model knows its slots', () => {
    const atx = find({ motherboard: ['mb-msi-b650-gaming-plus'] }, 'board').board!
    expect(atx.dimms).toHaveLength(4)
    expect(atx.pcie).toHaveLength(3)
    const itx = find({ motherboard: ['mb-asus-b650e-i'] }, 'board').board!
    expect(itx.pcie).toHaveLength(1)
  })

  it('air cooler height and AIO radiator size come from the data', () => {
    expect(find({ cooler: ['cool-noctua-d15g2'] }, 'cooler').size[0]).toBe(168)
    const rad = find({ cooler: ['cool-arctic-lf3-360'] }, 'radiator')
    expect(rad.size[2]).toBe(360)
    expect(rad.fanSize).toBe(120)
    expect(kinds({ cooler: ['cool-arctic-lf3-360'] })).toEqual(['aio-pump', 'aio-radiator'])
  })

  it('the case grows to fit its own GPU limit', () => {
    const l = layoutBuild(build({ case: ['case-lianli-216'] }))
    expect(l.hasCase).toBe(true)
    expect(l.box[2]).toBeGreaterThanOrEqual(392 + 60)
  })

  it('a part with a compatibility error is marked', () => {
    const b = build({ gpu: ['gpu-asus-5070ti-tuf'], case: ['case-cm-nr200p'] })
    const l = layoutBuild(b, new Map([['gpu-asus-5070ti-tuf', 'error']]))
    expect(l.items.find((s) => s.kind === 'gpu')!.error).toBe(true)
  })

  it('M.2 drives sit on the board, SATA drives in the front bay', () => {
    const [m2, hdd] = items({ storage: ['ssd-sam-990pro-1tb', 'hdd-sea-barracuda-2tb'] })
    expect(m2.kind).toBe('m2')
    expect(m2.pos[0]).toBeLessThan(0) // near the back wall
    expect(hdd.kind).toBe('hdd')
    expect(hdd.pos[2]).toBeGreaterThan(0) // towards the front
  })
})
