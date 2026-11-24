// iPon (ipon.hu): product URLs end with the part number and the iPon id,
// e.g. /shop/termek/amd-ryzen-7-5700x-340ghz-am4-oem-100-000000926/1989840
import { createSitemapSource } from './sitemap-shop.mjs'

export const { name, fetchOffers } = createSitemapSource({
  name: 'ipon',
  shop: 'iPon',
  base: 'https://ipon.hu',
  sitemap: 'https://ipon.hu/sitemap.xml',
  sitemapFilter: /\/sitemap\/product_\d+/,
  productUrl: /\/shop\/termek\//,
})
