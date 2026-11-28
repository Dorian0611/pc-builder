// BestByte (bestbyte.hu) – Hungarian shop, real HUF prices.
// robots.txt allows product pages; prices come from the page's schema.org JSON-LD
// (MPN + EAN), product URLs carry the product name ("…-7800x3d-box-processzor-p378259.html").
import { createSitemapSource } from './sitemap-shop.mjs'

export const { name, fetchOffers, foreign } = createSitemapSource({
  name: 'bestbyte',
  shop: 'BestByte',
  base: 'https://www.bestbyte.hu',
  sitemap: 'https://www.bestbyte.hu/sitemap.xml',
  // product sitemaps only, not the image ones
  sitemapFilter: /\/sitemap\d+\.xml/,
  productUrl: /-p\d+\.html$/,
  excludeUrl: /ujszeru|ujracsomagolt|bontott|outlet|hasznalt|felujitott|serult/i,
  // old, discontinued products come first in the sitemaps and have no price: newest ids first
  newestFirst: (url) => Number(url.match(/-p(\d+)\.html$/)?.[1] ?? 0),
  // open-box / repackaged / used items would drag the price down
  excludeName: /bontott|felújított|outlet|használt|újszerű|újracsomagolt|sérült dobozos/i,
  nameMatch: true,
})
