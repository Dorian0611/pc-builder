import { describe, expect, it } from 'vitest'
import { hufPer, parseEcbXml, toHungarianGross } from '../../scripts/prices/fx.mjs'
import { calibrate, MIN_OVERLAP } from '../../scripts/prices/foreign.mjs'

const ECB = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope><Cube><Cube time='2026-11-24'>
  <Cube currency='USD' rate='1.0500'/><Cube currency='GBP' rate='0.8400'/>
  <Cube currency='HUF' rate='400.00'/><Cube currency='PLN' rate='4.2000'/>
</Cube></Cube></gesmes:Envelope>`

describe('ECB rates and VAT', () => {
  const { date, rates } = parseEcbXml(ECB)
  it('parses the daily rates', () => {
    expect(date).toBe('2026-11-24')
    expect(rates).toMatchObject({ EUR: 1, HUF: 400, GBP: 0.84 })
    expect(hufPer('GBP', rates)).toBeCloseTo(476.19, 2)
  })
  it('converts a foreign gross price to a Hungarian gross price', () => {
    // 121 € with Dutch 21% VAT = 100 € net = 40 000 Ft net → 50 800 Ft with 27% VAT
    expect(toHungarianGross(121, 'EUR', 'NL', rates)).toBe(50_800)
    // 120 £ with 20% UK VAT = 100 £ net
    expect(toHungarianGross(120, 'GBP', 'GB', rates)).toBe(Math.round(100 * (400 / 0.84) * 1.27))
  })
  it('refuses unknown currencies and countries', () => {
    expect(() => toHungarianGross(1, 'XXX', 'NL', rates)).toThrow()
    expect(() => toHungarianGross(1, 'EUR', 'ZZ', rates)).toThrow()
  })
})

describe('calibrate', () => {
  const cat = (id: string) => (id.startsWith('g') ? 'gpu' : 'cpu')
  const many = (prefix: string, n: number, dom: number, fr: number) => {
    const d: Record<string, { medianHuf: number }> = {}
    const f: Record<string, { medianHuf: number }> = {}
    for (let i = 0; i < n; i++) {
      d[`${prefix}${i}`] = { medianHuf: dom }
      f[`${prefix}${i}`] = { medianHuf: fr }
    }
    return { d, f }
  }

  it('per category median ratio of Hungarian to converted foreign prices', () => {
    const g = many('g', MIN_OVERLAP, 110, 100) // gpu: Hungary 10% dearer
    const c = many('c', MIN_OVERLAP, 95, 100) // cpu: 5% cheaper
    const { factors, overlaps } = calibrate({ ...g.d, ...c.d }, { ...g.f, ...c.f }, cat)
    expect(factors.gpu).toBe(1.1)
    expect(factors.cpu).toBe(0.95)
    expect(overlaps.gpu).toBe(MIN_OVERLAP)
  })

  it('too few overlaps in a category → the overall ratio; too few overall → 1', () => {
    const g = many('g', MIN_OVERLAP, 120, 100)
    const c = many('c', 2, 200, 100)
    const { factors } = calibrate({ ...g.d, ...c.d }, { ...g.f, ...c.f }, cat)
    expect(factors.cpu).toBe(factors['*'])
    expect(calibrate({ a: { medianHuf: 1 } }, { a: { medianHuf: 1 } }, cat).factors['*']).toBe(1)
  })

  it('clamps absurd ratios', () => {
    const g = many('g', MIN_OVERLAP, 1000, 100)
    expect(calibrate(g.d, g.f, cat).factors.gpu).toBe(1.6)
  })
})
