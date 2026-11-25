// Generic shop source: sitemap → product pages that look like our parts → schema.org JSON-LD.
//
// Polite by design:
//  - robots.txt is read first; disallowed URLs are never fetched;
//  - one request at a time with a pause (default 3 s), identifying User-Agent;
//  - only product pages whose URL contains a part number we know are fetched,
//    and an offer is kept only if the page's own MPN/EAN belongs to that part;
//  - 403/429 stops the source; a time budget keeps the run bounded.
// Only the price and the product URL are taken from a page.

import { get, isSitemapIndex, parseProductJsonLd, robotsAllows, sitemapLocs, sleep } from '../http.mjs'
import { matchUrlTokens, pageConfirmsPart, slugKeysFromIdentifiers } from '../match.mjs'

/**
 * @typedef {object} ShopConfig
 * @property {string} name          source id, e.g. "ipon"
 * @property {string} shop          shop name shown on the site, e.g. "iPon"
 * @property {string} base          https://shop.hu
 * @property {string} sitemap       sitemap or sitemap index URL
 * @property {RegExp} [sitemapFilter]  which child sitemaps of an index to read
 * @property {RegExp} productUrl    which URLs are product pages
 * @property {(url: string, keys: Map<string,string>) => ({partId: string, key: string} | null)} [matchUrl]
 * @property {number} [delayMs]
 * @property {number} [timeBudgetMin]
 */

/** A part number that matches many different product URLs is too generic to trust. */
const MAX_URLS_PER_KEY = 4

/** @param {ShopConfig} cfg */
export function createSitemapSource(cfg) {
  const envPrefix = cfg.name.toUpperCase()
  const delay = Number(process.env[`${envPrefix}_DELAY_MS`] ?? cfg.delayMs ?? 3000)
  const budgetMs = Number(process.env[`${envPrefix}_TIME_BUDGET_MIN`] ?? cfg.timeBudgetMin ?? 300) * 60_000
  const matchUrl = cfg.matchUrl ?? matchUrlTokens

  /** @returns {Promise<import('../lib.mjs').Offer[]>} */
  async function fetchOffers({ identifiers, log = console.log, maxProductPages = Infinity, maxSitemaps = Infinity }) {
    if (process.env[`${envPrefix}_DISABLED`] === '1') {
      log(`${cfg.name}: disabled (${envPrefix}_DISABLED=1)`)
      return []
    }
    const started = Date.now()
    const timeLeft = () => budgetMs - (Date.now() - started)

    const robots = (await get(`${cfg.base}/robots.txt`)).body ?? ''
    const allowed = (url) => robotsAllows(robots, new URL(url).pathname + new URL(url).search)
    if (!allowed(cfg.sitemap)) throw new Error('robots.txt disallows the sitemap – not collecting')

    // 1. collect product URLs that contain one of our part numbers
    const keys = slugKeysFromIdentifiers(identifiers)
    /** @type {Map<string, {partId: string, key: string}>} */
    const candidates = new Map()
    const urlsPerKey = new Map()
    let sitemapsRead = 0
    let productUrls = 0
    const queue = [cfg.sitemap]
    while (queue.length && timeLeft() > 0 && sitemapsRead < maxSitemaps) {
      const sm = queue.shift()
      if (sitemapsRead > 0) await sleep(delay)
      const { body, error, status } = await get(sm)
      sitemapsRead++
      if (!body) {
        log(`${cfg.name}: sitemap failed ${sm} (HTTP ${status}${error ? `, ${error}` : ''})`)
        continue
      }
      const locs = sitemapLocs(body)
      if (isSitemapIndex(body)) {
        queue.push(...locs.filter((u) => !cfg.sitemapFilter || cfg.sitemapFilter.test(u)))
        continue
      }
      for (const url of locs) {
        if (!cfg.productUrl.test(url)) continue
        productUrls++
        const hit = matchUrl(url, keys)
        if (!hit || !allowed(url)) continue
        candidates.set(url, hit)
        urlsPerKey.set(hit.key, (urlsPerKey.get(hit.key) ?? 0) + 1)
      }
    }
    for (const [url, hit] of candidates) if ((urlsPerKey.get(hit.key) ?? 0) > MAX_URLS_PER_KEY) candidates.delete(url)
    if (productUrls === 0) throw new Error('no product URLs from the sitemaps – the site is not serving us')
    log(`${cfg.name}: ${sitemapsRead} sitemaps, ${productUrls} product URLs, ${candidates.size} look like our parts, ${Math.round((Date.now() - started) / 60000)} min`)

    // 2. fetch those pages and confirm the part from the page's own data
    const offers = []
    let fetched = 0
    let confirmed = 0
    let outOfStock = 0
    let failed = 0
    let consecutiveFailures = 0
    let diagnostics = 0
    /** Logs what the site sent instead of a product page (first few only). */
    const explain = (url, res, why) => {
      if (diagnostics++ >= 5) return
      const title = res.body?.match(/<title[^>]*>([^<]{0,80})/i)?.[1]?.trim()
      log(`${cfg.name}: ${why} – HTTP ${res.status}${res.error ? ` ${res.error}` : ''}, final URL ${res.url ?? '?'}, title "${title ?? ''}", ${res.body?.length ?? 0} bytes (${url})`)
    }
    for (const [url, { partId }] of candidates) {
      if (fetched >= maxProductPages || timeLeft() <= 0) {
        log(`${cfg.name}: stopping early after ${fetched} pages (limit reached)`)
        break
      }
      await sleep(delay)
      fetched++
      const res = await get(url)
      const { body, error } = res
      if (!body) {
        explain(url, res, 'no page')
        failed++
        consecutiveFailures++
        if (error && consecutiveFailures >= 10) {
          log(`${cfg.name}: 10 failures in a row, stopping early`)
          break
        }
        continue
      }
      consecutiveFailures = 0
      const page = parseProductJsonLd(body)
      if (!page || page.currency !== 'HUF' || !Number.isFinite(page.priceHuf)) {
        explain(url, res, page ? `price not in HUF (${page.currency})` : 'no product data')
        continue
      }
      if (!pageConfirmsPart(identifiers, partId, page)) continue
      confirmed++
      if (!page.inStock) {
        outOfStock++
        continue
      }
      offers.push({ source: cfg.name, shop: cfg.shop, priceHuf: page.priceHuf, partId, url })
    }
    log(
      `${cfg.name}: ${fetched} pages fetched, ${confirmed} confirmed, ${offers.length} in stock, ` +
        `${outOfStock} out of stock, ${failed} failed, ${Math.round((Date.now() - started) / 60000)} min total`,
    )
    if (fetched >= 20 && confirmed === 0) {
      const err = new Error(`${fetched} pages fetched but none had matching product data – the site is probably not serving us normal pages`)
      err.partialOffers = offers
      throw err
    }
    if (fetched > 20 && failed > fetched * 0.2) {
      const err = new Error(`${failed} failed pages out of ${fetched}`)
      err.partialOffers = offers
      throw err
    }
    return offers
  }

  return { name: cfg.name, fetchOffers }
}
