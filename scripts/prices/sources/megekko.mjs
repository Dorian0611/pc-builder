// Megekko (megekko.nl, Netherlands, EUR) – foreign shop: its prices only feed the estimate.
// Serves the bot from GitHub Actions; if it switches to its "check your browser" page,
// http.mjs stops the source (the check is never solved).
import { createSitemapSource } from './sitemap-shop.mjs'

export const { name, fetchOffers, foreign } = createSitemapSource({
  name: 'megekko',
  shop: 'Megekko',
  base: 'https://www.megekko.nl',
  sitemap: 'https://www.megekko.nl/sitemap/sitemap_index.xml',
  // any page URL: the part number must match in the URL and again on the page itself
  productUrl: /^https:\/\/www\.megekko\.nl\//,
  foreign: { country: 'NL', currency: 'EUR' },
})
