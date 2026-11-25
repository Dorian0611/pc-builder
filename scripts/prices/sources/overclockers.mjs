// Overclockers UK (overclockers.co.uk, GBP) – foreign shop: its prices only feed the estimate.
// "B Grade" items (refurbished / ex-display, codes starting with BG-) are skipped.
import { createSitemapSource } from './sitemap-shop.mjs'

export const { name, fetchOffers, foreign } = createSitemapSource({
  name: 'overclockers',
  shop: 'Overclockers UK',
  base: 'https://www.overclockers.co.uk',
  sitemap: 'https://www.overclockers.co.uk/sitemap_0-product.xml',
  productUrl: /\.html$/,
  excludeUrl: /\/BG-[^/]*\.html$/i,
  excludeName: /\bB[- ]?Grade\b|refurb|pre-?owned|open[- ]box|ex[- ]display/i,
  foreign: { country: 'GB', currency: 'GBP' },
})
