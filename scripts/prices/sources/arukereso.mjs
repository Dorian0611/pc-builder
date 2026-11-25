// Árukereső / Árgép price source through the Apify actor "zinc_grill/arukereso-argep-scraper".
//
// The project owner chose this source explicitly (2026-11-25), knowing that the actor uses an
// anti-detection browser and residential proxies to get past the sites' bot protection, and that
// it costs ~$1 per 1,000 results. It is the only source here that does not follow the
// "only where the site allows our bot" rule (see sources/index.mjs).
//
// The actor cannot search: it needs product page URLs. Those are kept by hand in
// data/arukereso-urls.csv (partId,url[,note]) – one line per part, Árukereső or Árgép URL.
//
// Needs the APIFY_TOKEN secret. Without it the source is skipped (not a failure).
// Off switch: ARUKERESO_DISABLED=1. Cost guard: ARUKERESO_MAX_URLS (default 500).

import fs from 'node:fs'
import path from 'node:path'
import { sleep } from '../http.mjs'
import { parseCsv } from './manual.mjs'

export const name = 'arukereso'

const ACTOR = 'zinc_grill~arukereso-argep-scraper'
const API = 'https://api.apify.com/v2'
// an unset repository variable arrives as "" → use the default
const MAX_URLS = Number(process.env.ARUKERESO_MAX_URLS) || 500
const RUN_TIMEOUT_MS = 90 * 60_000

/** Same product page however it was copied: no query, no fragment, no trailing slash, lowercase host. */
export function normalizeUrl(u) {
  try {
    const url = new URL(String(u).trim())
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return ''
  }
}

/** data/arukereso-urls.csv → Map(normalized URL → partId). Invalid lines are reported and skipped. */
export function readUrlList(csvText, knownPartIds, log = console.log) {
  const map = new Map()
  for (const row of parseCsv(csvText)) {
    const url = normalizeUrl(row.url)
    if (!row.partId || !url) continue
    if (!/(^|\.)(arukereso|argep)\.hu$/.test(new URL(url).host.replace(/^www\./, ''))) {
      log(`arukereso: not an Árukereső/Árgép URL, skipped: ${row.url}`)
      continue
    }
    if (knownPartIds && !knownPartIds.has(row.partId)) {
      log(`arukereso: unknown partId ${row.partId}, skipped`)
      continue
    }
    map.set(url, row.partId)
  }
  return map
}

/**
 * One actor dataset item → our offers (one per shop). Uses `allOffers` when present,
 * else the single lowest `price` + `seller`.
 * @returns {import('../lib.mjs').Offer[]}
 */
export function itemToOffers(item, urlToPart) {
  const partId = urlToPart.get(normalizeUrl(item.url))
  if (!partId) return []
  const source = item.source === 'argep' ? 'argep' : 'arukereso'
  const list = Array.isArray(item.allOffers) && item.allOffers.length ? item.allOffers : [{ seller: item.seller, price: item.price }]
  return list
    .map((o) => ({ source, shop: String(o.seller ?? '').trim(), priceHuf: Math.round(Number(o.price)), partId, url: item.url }))
    .filter((o) => o.shop && Number.isFinite(o.priceHuf))
}

async function api(pathAndQuery, token, init = {}) {
  const res = await fetch(`${API}${pathAndQuery}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`Apify ${init.method ?? 'GET'} ${pathAndQuery.split('?')[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** @returns {Promise<import('../lib.mjs').Offer[]>} */
export async function fetchOffers({ root, identifiers, log = console.log }) {
  if (process.env.ARUKERESO_DISABLED === '1') {
    log('arukereso: disabled (ARUKERESO_DISABLED=1)')
    return []
  }
  const token = process.env.APIFY_TOKEN
  if (!token) {
    log('arukereso: no APIFY_TOKEN secret set – skipped')
    return []
  }
  const file = path.join(root, 'data/arukereso-urls.csv')
  if (!fs.existsSync(file)) {
    log('arukereso: data/arukereso-urls.csv missing – skipped')
    return []
  }
  const urlToPart = readUrlList(fs.readFileSync(file, 'utf8'), identifiers ? new Set(Object.keys(identifiers)) : undefined, log)
  const urls = [...urlToPart.keys()].slice(0, MAX_URLS)
  if (urlToPart.size > MAX_URLS) log(`arukereso: ${urlToPart.size} URLs, only the first ${MAX_URLS} are used (ARUKERESO_MAX_URLS)`)
  if (!urls.length) {
    log('arukereso: no URLs in data/arukereso-urls.csv – skipped')
    return []
  }

  const input = {
    startUrls: urls.map((url) => ({ url })),
    maxRequestsPerCrawl: urls.length + 10,
    excludeShops: [],
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
  }
  const started = Date.now()
  let run = (await api(`/acts/${ACTOR}/runs`, token, { method: 'POST', body: JSON.stringify(input) })).data
  log(`arukereso: Apify run ${run.id} started for ${urls.length} URLs`)
  while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error(`Apify run ${run.id} still ${run.status} after 90 min`)
    await sleep(15_000)
    run = (await api(`/actor-runs/${run.id}?waitForFinish=60`, token)).data
  }
  if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${run.id} ended ${run.status}`)

  const items = await api(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json`, token)
  const offers = items.flatMap((it) => itemToOffers(it, urlToPart))
  const pages = new Set(items.map((it) => normalizeUrl(it.url)))
  if (items.length && !offers.length) {
    // the actor's output did not look as documented: show its shape so the mapping can be fixed
    log(`arukereso: no offers mapped – first item: ${JSON.stringify(items[0]).slice(0, 1500)}`)
  }
  log(
    `arukereso: ${items.length} pages scraped (${urls.length - pages.size} of ${urls.length} URLs gave nothing), ` +
      `${offers.length} shop offers, ${Math.round((Date.now() - started) / 60000)} min`,
  )
  return offers
}
