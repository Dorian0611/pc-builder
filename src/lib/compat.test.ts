import { describe, expect, it } from 'vitest'
import { fixtureCatalog } from '../test/fixtureCatalog'
import { candidateErrors } from './builder'
import { checkBuild, estimatePower } from './compat'

const { resolveBuild, getPart } = fixtureCatalog
import type { BuildSelection, CheckLevel } from './types'

const levelOf = (sel: BuildSelection, rule: string): CheckLevel[] =>
  checkBuild(resolveBuild(sel))
    .filter((c) => c.rule === rule)
    .map((c) => c.level)

const good: BuildSelection = {
  cpu: ['cpu-r5-7600'],
  motherboard: ['mb-msi-b650-gaming-plus'],
  memory: ['ram-kf-ddr5-2x16-6000'],
  gpu: ['gpu-msi-4060-ventus2x'],
  storage: ['ssd-sam-990pro-1tb'],
  psu: ['psu-bq-pp12m-650'],
  case: ['case-fractal-north'],
  cooler: ['cool-tr-pa120se'],
}

describe('checkBuild', () => {
  it('a jó összeállítás minden ellenőrzése zöld', () => {
    const r = checkBuild(resolveBuild(good))
    expect(r.length).toBeGreaterThan(8)
    expect(r.filter((c) => c.level !== 'ok')).toEqual([])
  })

  it('eltérő foglalat piros', () => {
    expect(levelOf({ ...good, cpu: ['cpu-i5-14600k'] }, 'cpu-socket')).toEqual(['error'])
  })

  it('DDR4 memória DDR5 alaplapon piros', () => {
    expect(levelOf({ ...good, memory: ['ram-kf-ddr4-2x8-3200'] }, 'memory-type')).toContain('error')
  })

  it('túl sok modul ITX lapon piros', () => {
    const sel = { ...good, motherboard: ['mb-asus-b650e-i'], memory: ['ram-kf-ddr5-2x16-6000', 'ram-kf-ddr5-2x16-6000'] }
    expect(levelOf(sel, 'memory-capacity')).toEqual(['error'])
  })

  it('ATX lap mATX házban piros', () => {
    expect(levelOf({ ...good, case: ['case-cm-q300l'] }, 'board-size')).toEqual(['error'])
  })

  it('hosszú GPU kis házban piros', () => {
    const sel = { ...good, motherboard: ['mb-asus-b650e-i'], gpu: ['gpu-asus-5070ti-tuf'], case: ['case-cm-nr200p'] }
    expect(levelOf(sel, 'gpu-length')).toEqual(['error'])
  })

  it('magas léghűtő alacsony házban piros', () => {
    const sel = { ...good, cooler: ['cool-noctua-d15g2'], case: ['case-nzxt-h5flow'] }
    expect(levelOf(sel, 'cooler-fit')).toEqual(['error'])
  })

  it('AM5-only hűtő Intel CPU-n piros', () => {
    const sel = { ...good, cpu: ['cpu-cu5-245k'], motherboard: ['mb-msi-b860-p'], cooler: ['cool-noctua-l9a-am5'] }
    expect(levelOf(sel, 'cooler-socket')).toEqual(['error'])
  })

  it('gyenge táp erős GPU-hoz sárga vagy piros', () => {
    const sel = { ...good, cpu: ['cpu-r7-7800x3d'], gpu: ['gpu-msi-5080-gaming'], psu: ['psu-cor-cx550'] }
    expect(levelOf(sel, 'psu-wattage')[0]).not.toBe('ok')
  })

  it('12V-2x6 nélküli táp figyelmeztet', () => {
    const sel = { ...good, gpu: ['gpu-gb-5070-windforce'], psu: ['psu-cor-cx550'] }
    expect(levelOf(sel, 'psu-connectors')).toEqual(['warning'])
  })

  it('Ryzen 9000 B650 lapon BIOS figyelmeztetés', () => {
    expect(levelOf({ ...good, cpu: ['cpu-r7-9700x'] }, 'bios')).toEqual(['warning'])
  })

  it('F-es CPU videókártya nélkül piros', () => {
    const sel = { ...good, cpu: ['cpu-i5-14400f'], motherboard: ['mb-asus-b760m-a'], gpu: [] }
    expect(levelOf(sel, 'igpu')).toEqual(['error'])
  })

  it('SFX táp nem kell ATX-only házba', () => {
    const sel = { ...good, motherboard: ['mb-gb-b650m-ds3h'], case: ['case-cm-q300l'], psu: ['psu-cor-sf750'] }
    expect(levelOf(sel, 'psu-size')).toEqual(['error'])
  })

  it('túl sok M.2 SSD figyelmeztet', () => {
    const sel = { ...good, storage: ['ssd-sam-990pro-1tb', 'ssd-wd-sn850x-2tb', 'ssd-king-nv3-1tb'] }
    expect(levelOf(sel, 'storage-slots')).toEqual(['warning'])
  })

  it('hiányzó adat "nem ellenőrizhető", nem zöld', () => {
    const b = resolveBuild(good)
    const gpu = { ...b.gpu!, lengthMm: undefined as unknown as number }
    const r = checkBuild({ ...b, gpu }).find((c) => c.rule === 'gpu-length')
    expect(r?.level).toBe('unknown')
  })
})

describe('candidateErrors', () => {
  it('AM5 lap mellett az Intel CPU nem kompatibilis jelölt', () => {
    const sel = { motherboard: ['mb-msi-b650-gaming-plus'] }
    expect(candidateErrors(fixtureCatalog, sel, getPart('cpu-i5-14600k')!)).not.toEqual([])
    expect(candidateErrors(fixtureCatalog, sel, getPart('cpu-r5-7600')!)).toEqual([])
  })
})

describe('AIO hűtő', () => {
  it('radiátoradat nélküli háznál "nem ellenőrizhető"', () => {
    const b = resolveBuild({ ...good, cooler: ['cool-arctic-lf3-360'] })
    const r = checkBuild({ ...b, case: { ...b.case!, radiatorSizesMm: undefined } })
    expect(r.find((c) => c.rule === 'cooler-fit')?.level).toBe('unknown')
  })
})

describe('estimatePower', () => {
  it('ismeretlen GPU-fogyasztásnál bizonytalan becslés', () => {
    const b = resolveBuild(good)
    const e = estimatePower({ ...b, gpu: { ...b.gpu!, tdpW: undefined } })
    expect(e.uncertain).toBe(true)
  })

  it('a javasolt táp a csúcs +30%, 50 W-ra kerekítve', () => {
    const e = estimatePower(resolveBuild(good))
    expect(e.recommendedW).toBeGreaterThanOrEqual(e.peakW * 1.3)
    expect(e.recommendedW % 50).toBe(0)
  })
})
