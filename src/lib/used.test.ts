import { describe, expect, it } from 'vitest'
import { aggregateUsed, MIN_ADS, parseHuf, usedKeyOf, usedPricesByPart } from '../../scripts/prices/used.mjs'
import { parseAdList } from '../../scripts/prices/sources/hardverapro.mjs'
import { cpuNameKey } from '../../scripts/perf.mjs'
import { addEstimates } from './estimates'
import type { CatalogData, Part } from './types'

const key = (t: string) => usedKeyOf(t, cpuNameKey)

describe('used-market ads', () => {
  it('reads asking prices', () => {
    expect(parseHuf('9 000 Ft')).toBe(9000)
    expect(parseHuf('1 249 990 Ft')).toBe(1249990)
    expect(parseHuf('Keresem')).toBeUndefined()
  })

  it('one used CPU by model, one graphics card by chip', () => {
    expect(key('AMD Ryzen 5 3600 processzor (AM4) megkímélt, hibátlan')).toEqual({ kind: 'cpu', key: 'ryzen 5 3600' })
    expect(key('Eladó hibátlan ROG-STRIX-RTX3070TI-O8G-GAMING!')).toEqual({ kind: 'gpu', key: 'GeForce RTX 3070 Ti' })
    expect(key('Sapphire Pulse RX 7800 XT 16GB')).toEqual({ kind: 'gpu', key: 'Radeon RX 7800 XT' })
  })

  it('skips wanted ads, new boxed items, bundles, faulty parts, laptops and multi-model ads', () => {
    for (const t of [
      'Videokártyákat veszek!',
      'Keresem: RTX 3070',
      'Új, bontatlan ASUS PRIME RX 9070 XT OC 16GB - Beszámítás',
      'Gigabyte ga-z370p-d3++i7 8700k+Cooler master hűtő',
      'RTX 3080 hibás, alkatrésznek',
      'Intel Core I7 3632QM processzor laptop notebook',
      'Eladó -I5-6500 -i5-7400 -i5-7500 cpu',
      'Intel Core i7-8700 / i5-9500 / i3-9100 / több db',
      'RTX 3070 vagy RX 6800 eladó',
    ])
      expect(key(t), t).toBeUndefined()
  })

  it('median per model, outliers dropped, too few ads → nothing', () => {
    const ads = [40000, 42000, 44000, 45000, 1, 400000].map((priceHuf) => ({ kind: 'cpu', key: 'ryzen 5 5600x', priceHuf }))
    const thin = Array.from({ length: MIN_ADS - 1 }, () => ({ kind: 'gpu', key: 'GeForce RTX 3080', priceHuf: 180000 }))
    const agg = aggregateUsed([...ads, ...thin])
    expect(agg.get('cpu:ryzen 5 5600x')).toEqual({ medianHuf: 43000, minHuf: 40000, count: 4 })
    expect(agg.has('gpu:GeForce RTX 3080')).toBe(false)
  })

  it('model/chip prices reach every matching part, VRAM variants included', () => {
    const prices = new Map([
      ['cpu:ryzen 5 3600', { medianHuf: 23000, minHuf: 20000, count: 5 }],
      ['gpu:GeForce RTX 3060', { medianHuf: 85000, minHuf: 80000, count: 6 }],
    ])
    const out = usedPricesByPart(
      prices,
      [{ id: 'c1', brand: 'AMD', name: 'Ryzen 5 3600' }, { id: 'c2', brand: 'AMD', name: 'Ryzen 5 3600X' }],
      [{ id: 'g1', chip: 'GeForce RTX 3060 12 GB' }, { id: 'g2', chip: 'GeForce RTX 3060 Ti' }],
      cpuNameKey,
    )
    expect(Object.keys(out).sort()).toEqual(['c1', 'g1'])
  })

  it('reads the HardverApró listing markup, nothing about the seller', () => {
    const html = `<li class="media" data-uadid="7821359"><div class="uad-col uad-col-title"><h1>
      <a href="https://hardverapro.hu/apro/amd_ryzen_5_2600_jygq/friss.html">AMD Ryzen 5 2600</a></h1>
      <div class="uad-price"><span class="text-nowrap">9 000 Ft</span></div></div>
      <div class="uad-user"><a href="/tag/someone.html">someone</a></div><div class="uad-cities">Budapest</div></li>`
    expect(parseAdList(html)).toEqual([
      { id: '7821359', url: 'https://hardverapro.hu/apro/amd_ryzen_5_2600_jygq/friss.html', title: 'AMD Ryzen 5 2600', priceHuf: 9000 },
    ])
  })
})

describe('used prices on the site', () => {
  const part = (id: string, extra: Partial<Part> = {}) => ({ id, category: 'cpu', brand: 'AMD', name: id, socket: 'AM4', ...extra }) as Part
  const used = { updatedAt: '2026-11-28', items: { old: { medianHuf: 23040, minHuf: 20000, offerCount: 5, sources: ['hardverapro'] } } }

  it('only when there is no new price; a real or foreign price wins', () => {
    const data = { cpu: [part('old'), part('sold', { price: { medianHuf: 50000, minHuf: 50000, offerCount: 1, updatedAt: '', sources: ['pcx'] } })] } as unknown as CatalogData
    addEstimates(data, undefined, { ...used, items: { ...used.items, sold: used.items.old } })
    const [old, sold] = data.cpu
    expect(old.estimate).toMatchObject({ basis: 'used', medianHuf: 23000, count: 5 })
    expect(sold.estimate).toBeUndefined()
  })
})
