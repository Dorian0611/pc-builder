// Price pipeline core: offer matching, aggregation, merging, history.
// Pure functions only (no I/O) so they can be unit tested.

/**
 * @typedef {object} Offer  One shop's price for one product, as a source reports it.
 * @property {string} source     where we got it from, e.g. "manual", "arukereso"
 * @property {string} shop       the shop selling it, e.g. "iPon"
 * @property {number} priceHuf   gross price in HUF
 * @property {string} [partId]   OpenDB id, if the source already knows it
 * @property {string} [mpn]      manufacturer part number
 * @property {string} [ean]      EAN / GTIN barcode
 * @property {string} [url]      product page at the source (shown as link)
 *
 * @typedef {object} PriceBlock
 * @property {number} medianHuf
 * @property {number} minHuf
 * @property {number} offerCount
 * @property {string} updatedAt     ISO date (YYYY-MM-DD)
 * @property {string[]} sources
 * @property {{ source: string, url: string }[]} [links]
 * @property {'jump'} [flag]        median moved suspiciously vs. the previous run
 */

/** Uppercase, strip spaces, dashes, dots, slashes: "BX80715 14400F" → "BX8071514400F" */
export const normalizeMpn = (s) => String(s ?? '').toUpperCase().replace(/[\s\-_./]/g, '')

/** Digits only, padded to EAN-13 (UPC-A → EAN-13). Returns '' if not a plausible barcode. */
export function normalizeEan(s) {
  const d = String(s ?? '').replace(/\D/g, '')
  return d.length >= 8 && d.length <= 14 ? d.padStart(13, '0').slice(-13) : ''
}

/**
 * Builds lookup maps from data/part-identifiers.json.
 * An MPN/EAN that belongs to more than one part is ambiguous and is dropped.
 */
export function buildIndex(identifiers) {
  const mpn = new Map()
  const ean = new Map()
  const add = (map, key, id) => {
    if (!key) return
    const cur = map.get(key)
    if (cur === undefined) map.set(key, id)
    else if (cur !== id) map.set(key, null) // ambiguous
  }
  for (const [id, ids] of Object.entries(identifiers)) {
    for (const m of ids.mpn ?? []) add(mpn, normalizeMpn(m), id)
    for (const e of ids.ean ?? []) add(ean, normalizeEan(e), id)
  }
  return { mpn, ean, ids: new Set(Object.keys(identifiers)) }
}

/** OpenDB id for an offer: explicit id, then EAN (most reliable), then MPN. */
export function matchOffer(index, offer) {
  if (offer.partId) return index.ids.has(offer.partId) ? offer.partId : undefined
  const byEan = index.ean.get(normalizeEan(offer.ean))
  if (byEan) return byEan
  const byMpn = index.mpn.get(normalizeMpn(offer.mpn))
  return byMpn || undefined
}

export const MIN_PRICE_HUF = 500
export const MAX_PRICE_HUF = 10_000_000

export const isValidOffer = (o) =>
  Number.isFinite(o.priceHuf) && o.priceHuf >= MIN_PRICE_HUF && o.priceHuf <= MAX_PRICE_HUF && !!o.shop

export function median(values) {
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

const shopKey = (shop) => String(shop).toLowerCase().replace(/[^a-z0-9áéíóöőúüű]/g, '')

/**
 * Groups matched offers by part and computes the price block.
 * The same shop seen through several sources counts once (its lowest price),
 * so a shop listed on both Árukereső and Árgép doesn't skew the median.
 *
 * @param {{ partId: string, offer: Offer }[]} matched
 * @param {string} today  YYYY-MM-DD
 * @returns {Record<string, PriceBlock>}
 */
export function aggregate(matched, today) {
  /** @type {Map<string, { shops: Map<string, number>, sources: Set<string>, links: Map<string, string> }>} */
  const byPart = new Map()
  for (const { partId, offer } of matched) {
    let g = byPart.get(partId)
    if (!g) byPart.set(partId, (g = { shops: new Map(), sources: new Set(), links: new Map() }))
    const k = shopKey(offer.shop)
    const prev = g.shops.get(k)
    if (prev === undefined || offer.priceHuf < prev) g.shops.set(k, offer.priceHuf)
    g.sources.add(offer.source)
    if (offer.url && !g.links.has(offer.source)) g.links.set(offer.source, offer.url)
  }
  /** @type {Record<string, PriceBlock>} */
  const out = {}
  for (const [partId, g] of byPart) {
    const prices = [...g.shops.values()]
    out[partId] = {
      medianHuf: median(prices),
      minHuf: Math.min(...prices),
      offerCount: prices.length,
      updatedAt: today,
      sources: [...g.sources].sort(),
      ...(g.links.size ? { links: [...g.links].map(([source, url]) => ({ source, url })) } : {}),
    }
  }
  return out
}

/** Median change above this ratio (either way) gets flagged for review. */
export const JUMP_RATIO = 0.4
/**
 * Prices not refreshed for this many days are dropped (product probably gone).
 * Runs are ~15 days apart, so a price survives one missed run.
 */
export const MAX_AGE_DAYS = 35

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/**
 * Merges today's prices over the previous file:
 * - fresh price → replaces the old one (flagged if the median jumped);
 * - no fresh price → the last good price stays with its old date, up to MAX_AGE_DAYS.
 */
export function mergePrices(previous, fresh, today) {
  /** @type {Record<string, PriceBlock>} */
  const out = {}
  for (const [id, old] of Object.entries(previous)) {
    if (!fresh[id] && daysBetween(old.updatedAt, today) <= MAX_AGE_DAYS) out[id] = { ...old, flag: undefined }
  }
  for (const [id, p] of Object.entries(fresh)) {
    const old = previous[id]
    const jumped = old && Math.abs(p.medianHuf - old.medianHuf) / old.medianHuf > JUMP_RATIO
    out[id] = jumped ? { ...p, flag: 'jump' } : p
  }
  for (const p of Object.values(out)) if (p.flag === undefined) delete p.flag
  return out
}

/** History rows only for parts whose price actually changed today (keeps git history small). */
export function historyRows(previous, next, today) {
  const rows = []
  for (const [id, p] of Object.entries(next)) {
    if (p.updatedAt !== today) continue
    const old = previous[id]
    if (old && old.medianHuf === p.medianHuf && old.minHuf === p.minHuf && old.offerCount === p.offerCount) continue
    rows.push(`${today},${id},${p.medianHuf},${p.minHuf},${p.offerCount}`)
  }
  return rows.sort()
}
