import { describe, expect, it } from 'vitest'
import {
  aggregate,
  buildIndex,
  historyRows,
  isValidOffer,
  matchOffer,
  median,
  mergePrices,
  normalizeEan,
  normalizeMpn,
} from '../../scripts/prices/lib.mjs'
import { parseCsv } from '../../scripts/prices/sources/manual.mjs'

const identifiers = {
  'cpu-a': { mpn: ['BX8071514400F'], ean: ['5032037278522'] },
  'cpu-b': { mpn: ['100-100001404WOF'] },
  'dup-1': { mpn: ['SAME-PN'] },
  'dup-2': { mpn: ['SAME-PN'] },
  'upc-part': { ean: ['0735858327718'] },
}
const index = buildIndex(identifiers)
const offer = (shop: string, priceHuf: number, extra: object = {}) => ({ source: 'manual', shop, priceHuf, ...extra })

describe('normalization', () => {
  it('MPN ignores case, spaces, dashes and dots', () => {
    expect(normalizeMpn('bx80715 14400-f')).toBe(normalizeMpn('BX8071514400F'))
  })
  it('UPC-A becomes EAN-13', () => {
    expect(normalizeEan('735858327718')).toBe('0735858327718')
    expect(normalizeEan('12')).toBe('')
  })
})

describe('matchOffer', () => {
  it('matches by EAN, then MPN, then explicit id', () => {
    expect(matchOffer(index, offer('x', 1, { ean: '5032037278522' }))).toBe('cpu-a')
    expect(matchOffer(index, offer('x', 1, { mpn: '100-100001404-wof' }))).toBe('cpu-b')
    expect(matchOffer(index, offer('x', 1, { ean: '735858327718' }))).toBe('upc-part')
    expect(matchOffer(index, offer('x', 1, { partId: 'cpu-b' }))).toBe('cpu-b')
  })
  it('ambiguous or unknown identifiers do not match', () => {
    expect(matchOffer(index, offer('x', 1, { mpn: 'SAME-PN' }))).toBeUndefined()
    expect(matchOffer(index, offer('x', 1, { mpn: 'NOPE' }))).toBeUndefined()
    expect(matchOffer(index, offer('x', 1, { partId: 'not-in-db' }))).toBeUndefined()
  })
})

describe('aggregate', () => {
  it('median ignores an extreme shop, minimum is shown separately', () => {
    expect(median([100, 300, 200])).toBe(200)
    expect(median([100, 200, 300, 9000])).toBe(250)
    const r = aggregate(
      [
        { partId: 'cpu-a', offer: offer('iPon', 55000) },
        { partId: 'cpu-a', offer: offer('Alza', 52000) },
        { partId: 'cpu-a', offer: offer('Bolt3', 58000) },
        { partId: 'cpu-a', offer: offer('Drága', 99000) },
      ],
      '2026-11-24',
    )
    expect(r['cpu-a']).toMatchObject({ medianHuf: 56500, minHuf: 52000, offerCount: 4, updatedAt: '2026-11-24' })
  })
  it('the same shop from two sources counts once, at its lower price', () => {
    const r = aggregate(
      [
        { partId: 'cpu-a', offer: { source: 'arukereso', shop: 'iPon.hu', priceHuf: 55000, url: 'https://a/1' } },
        { partId: 'cpu-a', offer: { source: 'argep', shop: 'IPON.HU', priceHuf: 54000, url: 'https://b/1' } },
      ],
      '2026-11-24',
    )
    expect(r['cpu-a']).toMatchObject({ offerCount: 1, minHuf: 54000, sources: ['argep', 'arukereso'] })
    expect(r['cpu-a'].links).toHaveLength(2)
  })
  it('rejects zero, absurd and shopless offers', () => {
    expect(isValidOffer(offer('x', 0))).toBe(false)
    expect(isValidOffer(offer('x', 50_000_000))).toBe(false)
    expect(isValidOffer(offer('', 50_000))).toBe(false)
    expect(isValidOffer(offer('x', 50_000))).toBe(true)
  })
})

describe('mergePrices', () => {
  const p = (medianHuf: number, updatedAt: string) => ({
    medianHuf, minHuf: medianHuf, offerCount: 3, updatedAt, sources: ['manual'],
  })
  it('keeps the last good price when a part has no fresh offers, until it gets too old', () => {
    const prev = { keep: p(1000, '2026-11-20'), stale: p(1000, '2026-11-01') }
    const r = mergePrices(prev, {}, '2026-11-24')
    expect(r.keep.updatedAt).toBe('2026-11-20')
    expect(r.stale).toBeUndefined()
  })
  it('flags a suspicious jump, and clears the flag later', () => {
    const r1 = mergePrices({ a: p(100_000, '2026-11-23') }, { a: p(30_000, '2026-11-24') }, '2026-11-24')
    expect(r1.a.flag).toBe('jump')
    const r2 = mergePrices(r1, { a: p(31_000, '2026-11-25') }, '2026-11-25')
    expect(r2.a.flag).toBeUndefined()
  })
})

describe('historyRows', () => {
  it('only writes rows for prices that changed today', () => {
    const prev = { same: { medianHuf: 1, minHuf: 1, offerCount: 1, updatedAt: 'x', sources: [] } }
    const next = {
      same: { medianHuf: 1, minHuf: 1, offerCount: 1, updatedAt: '2026-11-24', sources: [] },
      changed: { medianHuf: 2, minHuf: 2, offerCount: 2, updatedAt: '2026-11-24', sources: [] },
      old: { medianHuf: 3, minHuf: 3, offerCount: 3, updatedAt: '2026-11-20', sources: [] },
    }
    expect(historyRows(prev, next, '2026-11-24')).toEqual(['2026-11-24,changed,2,2,2'])
  })
})

describe('manual CSV', () => {
  it('parses quoted fields and skips comments', () => {
    const rows = parseCsv('# comment\nshop,priceHuf,mpn\n"Bolt, Kft.",54990,"A""B"\n')
    expect(rows).toEqual([{ shop: 'Bolt, Kft.', priceHuf: '54990', mpn: 'A"B' }])
  })
})
