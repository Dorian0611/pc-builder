// PCX (pcx.hu) price source.
//
// How it works (polite by design):
//  1. read pcx.hu/robots.txt and stop if the component listing is disallowed;
//  2. walk the public "Számítógép alkatrész" listing (?oldal=1..N, ~60 products a page,
//     ~130 pages), one request every few seconds;
//  3. each product card carries its name, PCX id and price in the page's ecommerce data;
//     the manufacturer part number is part of the name ("… (100-100001084WOF)" or the
//     last word), and the product URL ends with it too;
//  4. a product counts only if one of those part numbers matches exactly one OpenDB part.
// We take only the price and the product URL, nothing else from the page.
//
// Stop switch: repository variable PCX_DISABLED=1 (or remove pcx from SOURCES).

import { buildIndex, normalizeMpn } from '../lib.mjs'

export const name = 'pcx'

const BASE = 'https://www.pcx.hu'
const LISTING = '/szamitogep_alkatresz'
export const USER_AGENT = 'pc-builder-price-bot/1.0 (+https://github.com/Dorian0611/pc-builder)'
/** Pause between page requests. */
export const DELAY_MS = Number(process.env.PCX_DELAY_MS ?? 3000)
/** Safety limits. */
export const MAX_LISTING_PAGES = Number(process.env.PCX_MAX_PAGES ?? 400)
export const TIME_BUDGET_MS = Number(process.env.PCX_TIME_BUDGET_MIN ?? 60) * 60_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Blocked extends Error {}

const REQUEST_TIMEOUT_MS = 30_000
const NETWORK_RETRIES = 3

/**
 * GET with timeout and retries. Network errors are retried with a growing pause; if they
 * persist, returns { status: 0, body: null, error } so the caller can skip that page.
 * 403/429 twice in a row means PCX is refusing us: throw and stop.
 */
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (e) {
      if (attempt >= NETWORK_RETRIES) return { status: 0, body: null, error: String(e?.cause?.code ?? e?.name ?? 'network error') }
      await sleep(15_000 * attempt)
      continue
    }
    if (res.status === 403 || res.status === 429) {
      if (attempt >= 2) throw new Blocked(`${res.status} for ${url} – PCX is refusing us, stopping`)
      await sleep(60_000)
      continue
    }
    if (res.status >= 500 && attempt < 3) {
      await sleep(10_000 * attempt)
      continue
    }
    if (!res.ok) return { status: res.status, body: null }
    return { status: res.status, body: await res.text() }
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

const decodeJsonString = (s) => {
  try {
    return JSON.parse(`"${s}"`)
  } catch {
    return s
  }
}

/**
 * Reads one listing page: products from the cards' ecommerce data
 * (`"products":{"name":…,"id":…,"price":…}`), their URLs, and the last page number.
 */
export function parseListingPage(html) {
  const urls = new Map()
  for (const m of html.matchAll(/href="(\/[a-z0-9-]+-(\d{4,}))"/gi)) if (!urls.has(m[2])) urls.set(m[2], BASE + m[1])
  const items = new Map()
  for (const m of html.matchAll(/"products":\{"name":"((?:[^"\\]|\\.)*)","id":"(\d+)","price":"([\d.]+)"/g)) {
    const id = m[2]
    if (items.has(id)) continue
    items.set(id, { id, name: decodeJsonString(m[1]), priceHuf: Math.round(Number(m[3])), url: urls.get(id) })
  }
  let lastPage = 1
  for (const m of html.matchAll(/_steperOnChange\('(\d+)','stepp'\)/g)) lastPage = Math.max(lastPage, Number(m[1]))
  return { items: [...items.values()], lastPage }
}

/**
 * Possible manufacturer part numbers in a PCX product name: everything in parentheses
 * (also split on separators), and the last one or two words.
 * Only tokens with a digit and at least 5 characters are kept.
 */
export function mpnCandidates(productName) {
  const out = []
  for (const m of productName.matchAll(/\(([^()]+)\)/g)) {
    out.push(m[1])
    out.push(...m[1].split(/[,;]\s*|\s+/))
  }
  const words = productName.replace(/\([^()]*\)/g, ' ').trim().split(/\s+/)
  out.push(words.at(-1) ?? '', words.slice(-2).join(' '))
  return [...new Set(out.map((s) => s.trim()))].filter((s) => normalizeMpn(s).length >= 5 && /\d/.test(s))
}

/** Matches a listing item to an OpenDB part: part number in the name first, then the URL slug. */
export function matchListingItem(item, index, slugKeys) {
  for (const c of mpnCandidates(item.name)) {
    const id = index.mpn.get(normalizeMpn(c))
    if (id) return id
  }
  return (item.url && matchProductUrl(item.url, slugKeys)?.partId) || undefined
}

// ---------------------------------------------------------------- source

/** @returns {Promise<import('../lib.mjs').Offer[]>} */
export async function fetchOffers({ identifiers, log = console.log, maxPages = MAX_LISTING_PAGES }) {
  if (process.env.PCX_DISABLED === '1') {
    log('pcx: disabled (PCX_DISABLED=1)')
    return []
  }
  const started = Date.now()

  const robots = (await get(`${BASE}/robots.txt`)).body ?? ''
  if (!robotsAllows(robots, LISTING) || !robotsAllows(robots, `${LISTING}?oldal=2`))
    throw new Error('robots.txt disallows the component listing – not collecting')

  const index = buildIndex(identifiers)
  const slugKeys = slugKeysFromIdentifiers(identifiers)

  const offers = []
  let lastPage = 1
  let fetched = 0
  let listed = 0
  let networkErrors = 0
  let consecutiveErrors = 0
  for (let page = 1; page <= Math.min(lastPage, maxPages); page++) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      log(`pcx: stopping early at page ${page} (time limit)`)
      break
    }
    if (page > 1) await sleep(DELAY_MS)
    const { body, error } = await get(`${BASE}${LISTING}${page > 1 ? `?oldal=${page}` : ''}`)
    fetched++
    if (error || !body) {
      networkErrors++
      consecutiveErrors++
      log(`pcx: page ${page} failed (${error ?? 'no body'})`)
      if (consecutiveErrors >= 5) {
        log('pcx: 5 failed pages in a row, stopping early')
        break
      }
      continue
    }
    consecutiveErrors = 0
    const parsed = parseListingPage(body)
    if (page === 1) lastPage = parsed.lastPage
    listed += parsed.items.length
    for (const item of parsed.items) {
      if (!(item.priceHuf > 0)) continue
      const partId = matchListingItem(item, index, slugKeys)
      if (partId) offers.push({ source: name, shop: 'PCX', priceHuf: item.priceHuf, partId, url: item.url })
    }
  }
  log(`pcx: ${fetched}/${lastPage} listing pages, ${listed} products listed, ${offers.length} matched to our parts, ${networkErrors} failed pages, ${Math.round((Date.now() - started) / 60000)} min`)
  if (networkErrors > Math.max(5, fetched * 0.1)) {
    const err = new Error(`${networkErrors} failed pages out of ${fetched}`)
    err.partialOffers = offers
    throw err
  }
  return offers
}
