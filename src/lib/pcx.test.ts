import { describe, expect, it } from 'vitest'
import { buildIndex } from '../../scripts/prices/lib.mjs'
import {
  matchListingItem,
  matchProductUrl,
  mpnCandidates,
  parseListingPage,
  robotsAllows,
  slugKeysFromIdentifiers,
} from '../../scripts/prices/sources/pcx.mjs'
import { arukeresoSearchUrl, searchQuery } from './links'
import type { Part } from './types'

describe('robotsAllows', () => {
  const robots = `
User-Agent: Googlebot
Disallow: /

User-Agent: *
Allow: /
Disallow: /*search=
Allow: /*search=&
Disallow: /admin/
`
  it('uses the * group, longest rule wins', () => {
    expect(robotsAllows(robots, '/szamitogep_alkatresz?oldal=2')).toBe(true)
    expect(robotsAllows(robots, '/kereses?search=rtx')).toBe(false)
    expect(robotsAllows(robots, '/kereses?search=&x=1')).toBe(true)
    expect(robotsAllows(robots, '/admin/login')).toBe(false)
  })
  it('a full Disallow: / for * blocks everything', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /', '/anything')).toBe(false)
  })
})

// A trimmed copy of the structure of a real PCX listing card.
const card = (name: string, id: string, price: string, slug: string) => `
  <div class="product" data-statistic-depot='{"data":{"actionField":{"list":"Lista Sz\\u00e1m\\u00edt\\u00f3g\\u00e9p Alkatr\\u00e9sz"},"products":{"name":"${name}","id":"${id}","price":"${price}","category":"","brand":""}}}'>
    <a href="/${slug}-${id}">${name}</a>
  </div>`
const page = `<html>
  ${card('AMD Ryzen 7 9800X3D processzor (100-100001084WOF)', '358651', '159490.41', 'amd-ryzen-7-9800x3d-processzor-100-100001084wof')}
  ${card('Kingston 1TB M.2 NVMe 2280 KC3000 (SKC3000S/1024G) SSD', '111111', '45990.00', 'kingston-1tb-kc3000-skc3000s-1024g')}
  ${card('ASUS Video Card ROG Astral RTX 5090 (PCIe 5.0, 32GB GDDR7) 90YV0NF0-M0NA00', '222222', '1399990.5', 'asus-rog-astral-rtx-5090-90yv0nf0-m0na00')}
  ${card('Gembird A-HDMI-VGA-04 fekete HDMI - VGA adapter', '333333', '2990', 'gembird-a-hdmi-vga-04')}
  ${card('AMD Ryzen 7 9800X3D processzor (100-100001084WOF)', '358651', '159490.41', 'amd-ryzen-7-9800x3d-processzor-100-100001084wof')}
  <a href="javascript:_steperOnChange('2','stepp')">2</a><a href="javascript:_steperOnChange('133','stepp')">133</a>
</html>`

describe('parseListingPage', () => {
  it('reads name, id, price and URL once per product, and the last page', () => {
    const { items, lastPage } = parseListingPage(page)
    expect(lastPage).toBe(133)
    expect(items).toHaveLength(4)
    expect(items[0]).toEqual({
      id: '358651',
      name: 'AMD Ryzen 7 9800X3D processzor (100-100001084WOF)',
      priceHuf: 159490,
      url: 'https://www.pcx.hu/amd-ryzen-7-9800x3d-processzor-100-100001084wof-358651',
    })
  })
})

describe('mpnCandidates', () => {
  it('takes the part number from parentheses or the end of the name', () => {
    expect(mpnCandidates('AMD Ryzen 7 9800X3D processzor (100-100001084WOF)')).toContain('100-100001084WOF')
    expect(mpnCandidates('Kingston KC3000 (SKC3000S/1024G) SSD')).toContain('SKC3000S/1024G')
    expect(mpnCandidates('ASUS ROG Astral RTX 5090 (PCIe 5.0, 32GB) 90YV0NF0-M0NA00')).toContain('90YV0NF0-M0NA00')
  })
  it('ignores short or digit-free words', () => {
    expect(mpnCandidates('Ház darkFlash DS900 AIR fehér')).not.toContain('fehér')
  })
})

describe('matchListingItem', () => {
  const identifiers = {
    cpu: { mpn: ['100-100001084WOF'] },
    ssd: { mpn: ['SKC3000S/1024G'] },
    gpu: { mpn: ['90YV0NF0-M0NA00'] },
    slugOnly: { mpn: ['ZT-B50800D2-10P'] },
  }
  const index = buildIndex(identifiers)
  const keys = slugKeysFromIdentifiers(identifiers)
  it('matches by the part number in the name', () => {
    const [cpu, ssd, gpu, adapter] = parseListingPage(page).items
    expect(matchListingItem(cpu, index, keys)).toBe('cpu')
    expect(matchListingItem(ssd, index, keys)).toBe('ssd')
    expect(matchListingItem(gpu, index, keys)).toBe('gpu')
    expect(matchListingItem(adapter, index, keys)).toBeUndefined()
  })
  it('falls back to the URL slug', () => {
    const item = { id: '754157', name: 'Zotac RTX 5080 Solid Core', priceHuf: 1, url: 'https://www.pcx.hu/zotac-rtx-5080-solid-core-zt-b50800d2-10p-754157' }
    expect(matchListingItem(item, index, keys)).toBe('slugOnly')
  })
  it('URL slug matching ignores short and ambiguous part numbers', () => {
    const k = slugKeysFromIdentifiers({ a: { mpn: ['B650M'] }, b: { mpn: ['SAME-123456'] }, c: { mpn: ['SAME-123456'] } })
    expect(k.size).toBe(0)
    expect(matchProductUrl('https://www.pcx.hu/msi-b650m-123', k)).toBeNull()
  })
})

describe('Árukereső search link', () => {
  const part = { id: 'x', category: 'case', brand: 'Fractal Design', name: 'North ATX Mid Tower Black Tempered Glass Side Panel' } as Part
  it('uses brand + a short, cleaned name', () => {
    expect(searchQuery(part)).toBe('Fractal Design North ATX Mid Tower Tempered Glass')
    expect(arukeresoSearchUrl(part)).toBe(
      'https://www.arukereso.hu/CategorySearch.php?st=Fractal+Design+North+ATX+Mid+Tower+Tempered+Glass',
    )
  })
})
