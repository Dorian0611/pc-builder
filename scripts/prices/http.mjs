// Shared polite HTTP helpers for the shop sources: identifying User-Agent, timeouts,
// retries, robots.txt, sitemaps and schema.org JSON-LD.

import zlib from 'node:zlib'

export const USER_AGENT = 'pc-builder-price-bot/1.0 (+https://github.com/Dorian0611/pc-builder)'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class Blocked extends Error {}

const REQUEST_TIMEOUT_MS = 30_000
const NETWORK_RETRIES = 3

/**
 * GET with timeout and retries. Network errors and 5xx are retried with a growing pause;
 * if they persist, returns { status, body: null, error } so the caller can skip that URL.
 * 403/429 twice in a row means the site is refusing us: throws Blocked.
 * Gzipped bodies (sitemap .xml.gz) are unpacked.
 */
export async function get(url, { accept = 'text/html,application/xml' } = {}) {
  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (e) {
      if (attempt >= NETWORK_RETRIES) return { status: 0, body: null, url, error: String(e?.cause?.code ?? e?.name ?? 'network error') }
      await sleep(15_000 * attempt)
      continue
    }
    if (res.status === 403 || res.status === 429) {
      if (attempt >= 2) throw new Blocked(`${res.status} for ${url} – the site is refusing us, stopping`)
      await sleep(60_000)
      continue
    }
    // 511: eMAG-style bot block. Not retried, not worked around.
    if (res.status === 511) throw new Blocked(`511 for ${url} – the site blocks bots, stopping`)
    if (res.status >= 500 && attempt < NETWORK_RETRIES) {
      await sleep(10_000 * attempt)
      continue
    }
    if (!res.ok) return { status: res.status, body: null, url: res.url }
    const buf = Buffer.from(await res.arrayBuffer())
    const gz = buf[0] === 0x1f && buf[1] === 0x8b
    const body = (gz ? zlib.gunzipSync(buf) : buf).toString('utf8')
    // A CAPTCHA / "checking your browser" page means the site does not want bots: stop, never solve it.
    if (isChallengePage(body)) throw new Blocked(`${url} answered with a CAPTCHA / bot check – the site does not allow bots, stopping`)
    return { status: res.status, body, url: res.url }
  }
}

/** CAPTCHA or bot-check interstitial instead of real content. */
export function isChallengePage(html) {
  const head = html.slice(0, 6000)
  const title = head.match(/<title[^>]*>([^<]*)/i)?.[1] ?? ''
  return (
    /captcha|just a moment|attention required|are you a robot|access denied|bot check|ellenőrzés folyamatban/i.test(title) ||
    /cf-chl-|challenge-platform|g-recaptcha|hcaptcha.com|captcha-delivery/i.test(head)
  )
}

/**
 * Very small robots.txt reader: the Disallow/Allow rules of the "*" group,
 * longest match wins, "*" and "$" wildcards supported.
 */
export function robotsAllows(robotsTxt, path) {
  const rules = []
  let inStar = false
  let groupHasRules = false
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'user-agent') {
      if (groupHasRules) (inStar = false), (groupHasRules = false)
      if (val === '*') inStar = true
    } else if (key === 'allow' || key === 'disallow') {
      groupHasRules = true
      if (inStar && val) rules.push({ allow: key === 'allow', pattern: val })
    }
  }
  const toRegex = (p) =>
    new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, (c) => (c === '$' ? '$' : '\\' + c)).replace(/\*/g, '.*').replace(/\\\$$/, '$'))
  let best = null
  for (const r of rules) {
    if (toRegex(r.pattern).test(path) && (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)))
      best = r
  }
  return !best || best.allow
}

export const sitemapLocs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
export const isSitemapIndex = (xml) => /<sitemapindex[\s>]/i.test(xml)

const IN_STOCK = /InStock|LimitedAvailability|InStoreOnly|OnlineOnly/i

/** The schema.org Product in a page's JSON-LD: identifiers, price, currency, stock. */
export function parseProductJsonLd(html) {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data
    try {
      data = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const nodes = Array.isArray(data) ? data : data['@graph'] ?? [data]
    for (const node of nodes) {
      const types = [].concat(node?.['@type'] ?? [])
      if (!types.includes('Product')) continue
      const offer = [].concat(node.offers ?? [])[0]
      if (!offer) continue
      const price = Number(offer.price ?? offer.lowPrice)
      const gtin = node.gtin13 ?? node.gtin ?? node.gtin14 ?? node.gtin12 ?? node.ean
      const condition = String(offer.itemCondition ?? node.itemCondition ?? '').replace(/^https?:\/\/schema\.org\//, '')
      return {
        /** "" when the page doesn't say; "UsedCondition" / "RefurbishedCondition" are not new products */
        condition,
        isNew: !/Used|Refurbished|Damaged/i.test(condition),
        name: node.name ? String(node.name) : undefined,
        mpn: node.mpn ? String(node.mpn) : undefined,
        gtin: gtin ? String(gtin) : undefined,
        priceHuf: Number.isFinite(price) ? Math.round(price) : NaN,
        currency: offer.priceCurrency,
        inStock: IN_STOCK.test(String(offer.availability ?? '')),
      }
    }
  }
  return null
}
