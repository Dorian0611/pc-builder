// PCLand (pcland.hu) – Hungarian PC shop, real HUF prices.
// robots.txt allows everything; prices come from schema.org microdata on the product page,
// product URLs carry the name ("gigabyte-rtx-3060-gaming-oc-8g-20-lhr-videokartya-153729").
import { createSitemapSource } from './sitemap-shop.mjs'

export const { name, fetchOffers, foreign } = createSitemapSource({
  name: 'pcland',
  shop: 'PCLand',
  base: 'https://pcland.hu',
  sitemap: 'https://pcland.hu/sitemap.xml',
  productUrl: /^https:\/\/pcland\.hu\/[a-z0-9-]+-\d+$/,
  excludeUrl: /ajandekutalvany|ujszeru|ujracsomagolt|bontott|outlet|hasznalt|felujitott|serult/i,
  // open-box / repackaged / used items would drag the price down
  excludeName: /bontott|felújított|outlet|használt|újszerű|újracsomagolt|sérült dobozos/i,
  nameMatch: true,
})
