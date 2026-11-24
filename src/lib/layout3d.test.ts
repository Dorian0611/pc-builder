import { describe, expect, it } from 'vitest'
import { fixtureCatalog } from '../test/fixtureCatalog'
import { COLORS, layoutBuild } from './layout3d'
import type { BuildSelection } from './types'

const build = (sel: BuildSelection) => fixtureCatalog.resolveBuild(sel)
const keys = (sel: BuildSelection) => layoutBuild(build(sel)).shapes.map((s) => s.key)

describe('layoutBuild', () => {
  it('an empty build has no shapes', () => {
    expect(layoutBuild(build({})).shapes).toEqual([])
  })

  it('shows only what is in the build', () => {
    expect(keys({ gpu: ['gpu-msi-4060-ventus2x'] })).toEqual(['gpu', 'gpufan-0', 'gpufan-1'])
    expect(keys({ cpu: ['cpu-r5-7600'] })).toEqual(['cpu'])
  })

  it('uses the real GPU length', () => {
    const g = layoutBuild(build({ gpu: ['gpu-asus-5070ti-tuf'] })).shapes.find((s) => s.key === 'gpu')!
    expect(g.size[2]).toBe(348)
  })

  it('one RAM stick per module, capped by the board slots', () => {
    const sel = { motherboard: ['mb-asus-b650e-i'], memory: ['ram-kf-ddr5-2x16-6000', 'ram-kf-ddr5-2x16-6000'] }
    expect(keys(sel).filter((k) => k.startsWith('ram-'))).toHaveLength(2) // ITX: 2 slots
  })

  it('air cooler height and AIO radiator come from the data', () => {
    const air = layoutBuild(build({ cooler: ['cool-noctua-d15g2'] })).shapes.find((s) => s.key === 'cooler-fins')!
    expect(air.size[0]).toBe(168 - 10)
    const aio = layoutBuild(build({ cooler: ['cool-arctic-lf3-360'] })).shapes
    expect(aio.find((s) => s.key === 'radiator')!.size[2]).toBe(360)
    expect(aio.filter((s) => s.key.startsWith('radfan-'))).toHaveLength(3)
  })

  it('the case grows to fit its own GPU limit', () => {
    const l = layoutBuild(build({ case: ['case-lianli-216'] }))
    expect(l.hasCase).toBe(true)
    expect(l.box[2]).toBeGreaterThanOrEqual(392 + 60)
  })

  it('a part with a compatibility error is drawn red', () => {
    const b = build({ gpu: ['gpu-asus-5070ti-tuf'], case: ['case-cm-nr200p'] })
    const l = layoutBuild(b, new Map([['gpu-asus-5070ti-tuf', 'error']]))
    expect(l.shapes.find((s) => s.key === 'gpu')!.color).toBe(COLORS.error)
  })

  it('M.2 drives sit on the board, SATA drives in the front bay', () => {
    const l = layoutBuild(build({ storage: ['ssd-sam-990pro-1tb', 'hdd-sea-barracuda-2tb'] }))
    const [m2, hdd] = l.shapes
    expect(m2.pos[0]).toBeLessThan(0) // near the back wall
    expect(hdd.pos[2]).toBeGreaterThan(0) // towards the front
  })
})
