// eMAG (emag.hu): a large marketplace; ~1100 sitemaps of available offers. The part number
// is often somewhere in the URL slug, e.g. /msi-geforcer-gt-710-videokartya-…-gt-710-2gd3h-lp/pd/DWF003BBM/
import { createSitemapSource } from './sitemap-shop.mjs'

export const { name, fetchOffers } = createSitemapSource({
  name: 'emag',
  shop: 'eMAG',
  base: 'https://www.emag.hu',
  sitemap: 'https://www.emag.hu/sitemaps/offers-available-index.xml',
  productUrl: /\/pd\//,
})
