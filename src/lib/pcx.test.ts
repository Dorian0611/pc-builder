import { describe, expect, it } from 'vitest'
import {
  matchProductUrl,
  parseProductPage,
  robotsAllows,
  sitemapLocs,
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
    expect(robotsAllows(robots, '/zotac-rtx-5080-zt-b50800d2-10p-754157')).toBe(true)
    expect(robotsAllows(robots, '/kereses?search=rtx')).toBe(false)
    expect(robotsAllows(robots, '/kereses?search=&x=1')).toBe(true)
    expect(robotsAllows(robots, '/admin/login')).toBe(false)
  })
  it('a full Disallow: / for * blocks everything', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /', '/anything')).toBe(false)
  })
})

describe('sitemap and URL matching', () => {
  const keys = slugKeysFromIdentifiers({
    gpu: { mpn: ['ZT-B50800D2-10P'] },
    short: { mpn: ['B650M'] }, // too short / generic: ignored
    dupA: { mpn: ['SAME-123456'] },
    dupB: { mpn: ['SAME-123456'] },
  })
  it('reads <loc> entries', () => {
    expect(sitemapLocs('<urlset><url><loc>https://x/a-1</loc></url><url><loc> https://x/b-2 </loc></url></urlset>')).toEqual([
      'https://x/a-1',
      'https://x/b-2',
    ])
  })
  it('matches a slug ending in a known part number', () => {
    expect(matchProductUrl('https://www.pcx.hu/zotac-rtx-5080-16gd7-solid-core-zt-b50800d2-10p-754157', keys)).toEqual({
      partId: 'gpu',
      key: 'ztb50800d210p',
    })
  })
  it('ignores short, ambiguous and non-product URLs', () => {
    expect(keys.has('b650m')).toBe(false)
    expect(keys.has('same123456')).toBe(false)
    expect(matchProductUrl('https://www.pcx.hu/msi-b650m-123', keys)).toBeNull()
    expect(matchProductUrl('https://www.pcx.hu/kategoria/videokartya', keys)).toBeNull()
  })
})

describe('parseProductPage', () => {
  const page = (offer: object, extra: object = {}) =>
    `<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList"}</script>
     <script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku: '754157', mpn: 'ZT-B50800D2-10P', offers: { '@type': 'Offer', ...offer }, ...extra })}</script></html>`
  it('reads price, currency, mpn and stock', () => {
    expect(parseProductPage(page({ price: 529989.78, priceCurrency: 'HUF', availability: 'https://schema.org/InStock' }))).toEqual({
      mpn: 'ZT-B50800D2-10P',
      gtin: undefined,
      priceHuf: 529990,
      currency: 'HUF',
      inStock: true,
    })
  })
  it('marks out-of-stock offers', () => {
    expect(parseProductPage(page({ price: 1000, priceCurrency: 'HUF', availability: 'https://schema.org/OutOfStock' }))?.inStock).toBe(false)
  })
  it('returns null without a Product block', () => {
    expect(parseProductPage('<html><script type="application/ld+json">{"@type":"Organization"}</script></html>')).toBeNull()
    expect(parseProductPage('<script type="application/ld+json">{broken</script>')).toBeNull()
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
