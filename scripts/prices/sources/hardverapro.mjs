// HardverApró (hardverapro.hu) – the Hungarian used market for PC parts.
// Used prices only: they are shown for parts no Hungarian shop sells new (public/data/used-prices.json).
//
// Polite by design: robots.txt is read first (it forbids paging *search* results, which we
// never touch – we walk the plain category pages "…/videokartya/index.html?offset=N");
// one request every 3 s (robots asks for 1 s); identifying User-Agent; 403/429/CAPTCHA stops.
// From each ad only the title and the asking price are read; nothing about the seller.

import { get, robotsAllows, sleep } from '../http.mjs'
import { parseHuf, usedKeyOf } from '../used.mjs'
import { cpuNameKey } from '../../perf.mjs'

export const name = 'hardverapro'
/** marks the source for update-prices: its offers are used-market prices per model/chip */
export const used = true

const BASE = 'https://hardverapro.hu'
const CATEGORIES = ['/aprok/hardver/processzor/index.html', '/aprok/hardver/videokartya/index.html']
const PAGE_SIZE = 100
export const DELAY_MS = Number(process.env.HARDVERAPRO_DELAY_MS ?? 3000)
export const MAX_PAGES_PER_CATEGORY = Number(process.env.HARDVERAPRO_MAX_PAGES ?? 40)

/** Ads of one listing page: title, price, ad URL. */
export function parseAdList(html) {
  const ads = []
  for (const m of html.matchAll(/<li class="media" data-uadid="(\d+)"[\s\S]*?<\/li>/g)) {
    const block = m[0]
    const a = block.match(/<h1>\s*<a href="([^"]+)">([^<]+)<\/a>/)
    const price = parseHuf(block.match(/<div class="uad-price">\s*<span[^>]*>([^<]*)<\/span>/)?.[1] ?? '')
    if (a && price) ads.push({ id: m[1], url: a[1], title: a[2].trim(), priceHuf: price })
  }
  return ads
}

/** @returns {Promise<{ kind: string, key: string, priceHuf: number, url: string }[]>} */
export async function fetchOffers({ log = console.log, maxPages = MAX_PAGES_PER_CATEGORY } = {}) {
  if (process.env.HARDVERAPRO_DISABLED === '1') {
    log('hardverapro: disabled (HARDVERAPRO_DISABLED=1)')
    return []
  }
  const robotsRes = await get(`${BASE}/robots.txt`, { accept: 'text/plain,*/*' })
  if (!robotsRes.body) throw new Error(`robots.txt not readable (HTTP ${robotsRes.status}) – not collecting`)
  const out = []
  let pages = 0
  let listed = 0
  for (const cat of CATEGORIES) {
    for (let page = 0; page < Math.min(maxPages, MAX_PAGES_PER_CATEGORY); page++) {
      const path = page ? `${cat}?offset=${page * PAGE_SIZE}` : cat
      if (!robotsAllows(robotsRes.body, path)) throw new Error(`robots.txt disallows ${path} – not collecting`)
      if (pages++) await sleep(DELAY_MS)
      const { body, status } = await get(BASE + path)
      if (!body) {
        log(`hardverapro: ${path} failed (HTTP ${status})`)
        break
      }
      const ads = parseAdList(body)
      if (ads.length === 0) break // past the last page
      listed += ads.length
      for (const ad of ads) {
        const k = usedKeyOf(ad.title, cpuNameKey)
        if (k) out.push({ ...k, priceHuf: ad.priceHuf, url: ad.url })
      }
    }
  }
  log(`hardverapro: ${pages} pages, ${listed} ads, ${out.length} single used CPUs / graphics cards`)
  if (pages > 3 && listed === 0) throw new Error('no ads on the listing pages – the site is not serving us normal pages')
  return out
}
