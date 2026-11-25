import { describe, expect, it } from 'vitest'
import { aggregate, shopKey } from '../../scripts/prices/lib.mjs'
import { itemToOffers, normalizeUrl, readUrlList } from '../../scripts/prices/sources/arukereso.mjs'

const URL_A = 'https://www.arukereso.hu/processzor-c3139/amd/ryzen-7-9800x3d-box-100-100001084wof-p1154611732/'

describe('URL list', () => {
  it('normalizes product URLs', () => {
    expect(normalizeUrl(`${URL_A}?utm=x#top`)).toBe(normalizeUrl(URL_A))
    expect(normalizeUrl('not a url')).toBe('')
  })
  it('reads partId,url lines, skipping comments, foreign hosts and unknown parts', () => {
    const csv = [
      '# comment',
      'partId,url,note',
      `cpu-1,${URL_A},Ryzen 7 9800X3D`,
      'cpu-2,https://www.argep.hu/termek/x/,Árgép is fine',
      'cpu-3,https://www.pcx.hu/x-123,not Árukereső',
      `nope,${URL_A}x,unknown part`,
    ].join('\n')
    const logs: string[] = []
    const map = readUrlList(csv, new Set(['cpu-1', 'cpu-2', 'cpu-3']), (m: string) => logs.push(m))
    expect([...map.values()]).toEqual(['cpu-1', 'cpu-2'])
    expect(logs).toHaveLength(2)
  })
})

describe('itemToOffers', () => {
  const map = new Map([[normalizeUrl(URL_A), 'cpu-1']])
  it('turns every shop offer on the page into an offer', () => {
    const item = {
      url: URL_A,
      source: 'arukereso',
      price: 154800,
      seller: 'Foramax Computers',
      competitorsCount: 3,
      allOffers: [
        { seller: 'Foramax Computers', price: 154800 },
        { seller: 'Alza.hu', price: 156990, shipping: 0 },
        { seller: 'PCX', price: 159490 },
      ],
      fetchedAt: '2026-11-25T01:00:00Z',
    }
    const offers = itemToOffers(item, map)
    expect(offers).toHaveLength(3)
    expect(offers[0]).toEqual({ source: 'arukereso', shop: 'Foramax Computers', priceHuf: 154800, partId: 'cpu-1', url: URL_A })
  })
  it('falls back to the lowest price, and ignores pages we did not ask for', () => {
    expect(itemToOffers({ url: URL_A, source: 'argep', price: 1000, seller: 'X' }, map)).toEqual([
      { source: 'argep', shop: 'X', priceHuf: 1000, partId: 'cpu-1', url: URL_A },
    ])
    expect(itemToOffers({ url: 'https://www.arukereso.hu/other-p1/', price: 1, seller: 'X' }, map)).toEqual([])
  })
})

describe('shops across sources', () => {
  it('PCX from our crawler and "PCX.hu" from Árukereső count as one shop', () => {
    expect(shopKey('PCX.hu')).toBe(shopKey('PCX'))
    expect(shopKey('Valami Kft.')).toBe(shopKey('Valami'))
    const r = aggregate(
      [
        { partId: 'cpu-1', offer: { source: 'pcx', shop: 'PCX', priceHuf: 159490 } },
        { partId: 'cpu-1', offer: { source: 'arukereso', shop: 'PCX.hu', priceHuf: 159990, url: URL_A } },
        { partId: 'cpu-1', offer: { source: 'arukereso', shop: 'Alza.hu', priceHuf: 156990, url: URL_A } },
      ],
      '2026-11-25',
    )
    expect(r['cpu-1']).toMatchObject({ offerCount: 2, minHuf: 156990, sources: ['arukereso', 'pcx'] })
  })
})
