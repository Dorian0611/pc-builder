// PCX (pcx.hu) price source.
//
// How it works (polite by design):
//  1. read pcx.hu/robots.txt and stop if product pages are disallowed;
//  2. read the public sitemaps (~100k URLs) — product URLs end with the manufacturer
//     part number + PCX id, e.g. ".../geforce-rtx-5070-...-nh-u5veu-001-431516";
//  3. keep only URLs whose slug ends with a part number we know (OpenDB);
//  4. fetch those pages one at a time with a delay, read the schema.org Product
//     JSON-LD (price in HUF, mpn, availability) and accept the offer only if the
//     page's own mpn matches the part.
// We take only the price and the product URL, nothing else from the page.
//
// Stop switch: set PCX_DISABLED=1 (or remove pcx from SOURCES) if PCX objects.

import zlib from 'node:zlib'
import { normalizeMpn } from '../lib.mjs'

export const name = 'pcx'

const BASE = 'https://www.pcx.hu'
export const USER_AGENT = 'pc-builder-price-bot/1.0 (+https://github.com/Dorian0611/pc-builder)'
/** Pause between page requests. */
export const DELAY_MS = Number(process.env.PCX_DELAY_MS ?? 2000)
/** Hard limits so one run stays well inside the GitHub Actions job limit. */
export const MAX_PAGES = Number(process.env.PCX_MAX_PAGES ?? 4000)
export const TIME_BUDGET_MS = Number(process.env.PCX_TIME_BUDGET_MIN ?? 150) * 60_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Blocked extends Error {}

async function get(url, { binary = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: binary ? '*/*' : 'text/html,application/xml' } })
    if (res.status === 403 || res.status === 429) {
      if (attempt >= 2) throw new Blocked(`${res.status} for ${url} – PCX is refusing us, stopping`)
      await sleep(60_000) // back off once, then give up
      continue
    }
    if (res.status >= 500 && attempt < 3) {
      await sleep(10_000 * attempt)
      continue
    }
    if (!res.ok) return { status: res.status, body: null }
    return { status: res.status, body: binary ? Buffer.from(await res.arrayBuffer()) : await res.text() }
  }
}

// ---------------------------------------------------------------- pure helpers (unit tested)

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

export const sitemapLocs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])

/** Part numbers worth looking for in URL slugs: long enough and mixing letters and digits. */
export function slugKeysFromIdentifiers(identifiers) {
  /** @type {Map<string, string>} normalized mpn → partId (ambiguous ones removed) */
  const keys = new Map()
  for (const [id, ids] of Object.entries(identifiers)) {
    for (const m of ids.mpn ?? []) {
      const k = normalizeMpn(m).toLowerCase()
      if (k.length < 6 || !/[a-z]/.test(k) || !/\d/.test(k)) continue
      const cur = keys.get(k)
      keys.set(k, cur === undefined || cur === id ? id : null)
    }
  }
  for (const [k, v] of keys) if (v === null) keys.delete(k)
  return keys
}

/**
 * If the URL slug ends with a known part number (before the trailing "-<pcx id>"),
 * returns { partId, key }. Longest matching key wins.
 */
export function matchProductUrl(url, keys) {
  const m = url.match(/^https?:\/\/[^/]+\/([a-z0-9-]+)-(\d+)$/i)
  if (!m) return null
  const slug = m[1].toLowerCase().replace(/-/g, '')
  for (let len = Math.min(40, slug.length); len >= 6; len--) {
    const key = slug.slice(slug.length - len)
    const partId = keys.get(key)
    if (partId) return { partId, key }
  }
  return null
}

const IN_STOCK = /InStock|LimitedAvailability|InStoreOnly|OnlineOnly/i

/** Reads the schema.org Product from the page's JSON-LD blocks. */
export function parseProductPage(html) {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data
    try {
      data = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const nodes = Array.isArray(data) ? data : data['@graph'] ?? [data]
    for (const node of nodes) {
      if (node?.['@type'] !== 'Product') continue
      const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers
      if (!offer) continue
      const price = Number(offer.price ?? offer.lowPrice)
      return {
        mpn: node.mpn ? String(node.mpn) : undefined,
        gtin: node.gtin13 ?? node.gtin ?? undefined,
        priceHuf: Number.isFinite(price) ? Math.round(price) : NaN,
        currency: offer.priceCurrency,
        inStock: IN_STOCK.test(String(offer.availability ?? '')),
      }
    }
  }
  return null
}

// ---------------------------------------------------------------- source

/** @returns {Promise<import('../lib.mjs').Offer[]>} */
export async function fetchOffers({ identifiers, log = console.log, dryRun = false }) {
  if (process.env.PCX_DISABLED === '1') {
    log('pcx: disabled (PCX_DISABLED=1)')
    return []
  }
  const started = Date.now()

  const robots = (await get(`${BASE}/robots.txt`)).body ?? ''
  if (!robotsAllows(robots, '/sitemap-index.xml') || !robotsAllows(robots, '/some-product-123456'))
    throw new Error('robots.txt disallows sitemaps or product pages – not collecting')

  const keys = slugKeysFromIdentifiers(identifiers)
  const index = (await get(`${BASE}/sitemap-index.xml`)).body ?? ''
  /** @type {Map<string, {partId: string, key: string}>} */
  const candidates = new Map()
  let urlCount = 0
  for (const sm of sitemapLocs(index)) {
    await sleep(DELAY_MS)
    const { body } = await get(sm, { binary: true })
    if (!body) continue
    const xml = sm.endsWith('.gz') ? zlib.gunzipSync(body).toString('utf8') : body.toString('utf8')
    for (const url of sitemapLocs(xml)) {
      urlCount++
      const hit = matchProductUrl(url, keys)
      if (hit && robotsAllows(robots, new URL(url).pathname)) candidates.set(url, hit)
    }
  }
  log(`pcx: ${urlCount} URLs in sitemaps, ${candidates.size} look like our parts`)
  if (dryRun) return [...candidates].map(([url, c]) => ({ source: name, shop: 'PCX', priceHuf: NaN, partId: c.partId, url }))

  const offers = []
  let fetched = 0
  let mismatched = 0
  let outOfStock = 0
  for (const [url, { partId }] of candidates) {
    if (fetched >= MAX_PAGES || Date.now() - started > TIME_BUDGET_MS) {
      log(`pcx: stopping early at ${fetched} pages (limit reached)`)
      break
    }
    await sleep(DELAY_MS)
    fetched++
    const { body } = await get(url)
    if (!body) continue
    const p = parseProductPage(body)
    if (!p || p.currency !== 'HUF' || !Number.isFinite(p.priceHuf)) continue
    // the page must confirm the part number we guessed from the URL
    const ids = identifiers[partId]?.mpn ?? []
    if (!p.mpn || !ids.some((m) => normalizeMpn(m) === normalizeMpn(p.mpn))) {
      mismatched++
      continue
    }
    if (!p.inStock) {
      outOfStock++
      continue
    }
    offers.push({ source: name, shop: 'PCX', priceHuf: p.priceHuf, partId, url })
  }
  log(`pcx: ${fetched} pages fetched, ${offers.length} prices, ${outOfStock} out of stock, ${mismatched} part-number mismatches, ${Math.round((Date.now() - started) / 60000)} min`)
  return offers
}
