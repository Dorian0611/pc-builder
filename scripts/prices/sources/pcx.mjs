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
import { get, robotsAllows, sleep } from '../http.mjs'
import { matchProductUrl, slugKeysFromIdentifiers } from '../match.mjs'

// re-exported for the tests
export { robotsAllows, matchProductUrl, slugKeysFromIdentifiers }

export const name = 'pcx'

const BASE = 'https://www.pcx.hu'
const LISTING = '/szamitogep_alkatresz'
/** Pause between page requests. */
export const DELAY_MS = Number(process.env.PCX_DELAY_MS ?? 3000)
/** Safety limits. */
export const MAX_LISTING_PAGES = Number(process.env.PCX_MAX_PAGES ?? 400)
export const TIME_BUDGET_MS = Number(process.env.PCX_TIME_BUDGET_MIN ?? 60) * 60_000

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
