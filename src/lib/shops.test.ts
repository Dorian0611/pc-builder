import { describe, expect, it } from 'vitest'
import { parseProductJsonLd } from '../../scripts/prices/http.mjs'
import { matchUrlTokens, pageConfirmsPart, slugKeysFromIdentifiers } from '../../scripts/prices/match.mjs'

const identifiers = {
  cpu: { mpn: ['100-000000926'], ean: ['0730143314053'] },
  gpu: { mpn: ['GT 710 2GD3H LP'] },
  other: { mpn: ['CP-LS200X1'] },
}
const keys = slugKeysFromIdentifiers(identifiers)

describe('matchUrlTokens', () => {
  it('finds a part number anywhere in the path', () => {
    expect(matchUrlTokens('https://ipon.hu/shop/termek/amd-ryzen-7-5700x-340ghz-am4-oem-100-000000926/1989840', keys)?.partId).toBe('cpu')
    expect(matchUrlTokens('https://www.emag.hu/msi-geforcer-gt-710-videokartya-2-gb-ddr3-gt-710-2gd3h-lp/pd/DWF003BBM/', keys)?.partId).toBe('gpu')
  })
  it('returns null when nothing matches', () => {
    expect(matchUrlTokens('https://www.emag.hu/sharp-sumobox-hordozhato-hangszoro/pd/DZNT53YBM/', keys)).toBeNull()
  })
})

describe('parseProductJsonLd', () => {
  const page = (product: object) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [product] })}</script>`
  it('reads iPon-style @graph products', () => {
    const p = parseProductJsonLd(
      page({
        '@type': 'Product', name: 'AMD Ryzen 7 5700X', mpn: '100-000000926', gtin13: '5996409540061',
        offers: { '@type': 'Offer', price: 59990, priceCurrency: 'HUF', availability: 'https://schema.org/InStock' },
      }),
    )
    expect(p).toEqual({ name: 'AMD Ryzen 7 5700X', mpn: '100-000000926', gtin: '5996409540061', priceHuf: 59990, currency: 'HUF', inStock: true })
  })
  it('handles offers as an array and string prices', () => {
    const p = parseProductJsonLd(
      `<script type="application/ld+json">${JSON.stringify({ '@type': ['Product'], mpn: 'X1', offers: [{ price: '199000', priceCurrency: 'HUF', availability: 'http://schema.org/OutOfStock' }] })}</script>`,
    )
    expect(p).toMatchObject({ priceHuf: 199000, inStock: false })
  })
})

describe('pageConfirmsPart', () => {
  it('accepts a page whose MPN or EAN belongs to the part', () => {
    expect(pageConfirmsPart(identifiers, 'cpu', { mpn: '100 000000926' })).toBe(true)
    expect(pageConfirmsPart(identifiers, 'cpu', { mpn: 'shop-internal', gtin: '730143314053' })).toBe(true)
  })
  it('rejects a page about a different product', () => {
    expect(pageConfirmsPart(identifiers, 'cpu', { mpn: 'CP-LS200X1' })).toBe(false)
    expect(pageConfirmsPart(identifiers, 'cpu', { gtin: '5996409540061' })).toBe(false)
    expect(pageConfirmsPart(identifiers, 'cpu', null)).toBe(false)
  })
})
