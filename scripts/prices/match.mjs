// Matching shop products to OpenDB parts by manufacturer part number (MPN) or EAN.

import { normalizeEan, normalizeMpn } from './lib.mjs'

/**
 * Part numbers worth looking for inside URLs: long enough and mixing letters and digits,
 * or long all-digit numbers.
 * Normalized, lowercase → partId; part numbers shared by several parts are dropped.
 */
export function slugKeysFromIdentifiers(identifiers) {
  /** @type {Map<string, string>} */
  const keys = new Map()
  for (const [id, ids] of Object.entries(identifiers)) {
    for (const m of ids.mpn ?? []) {
      const k = normalizeMpn(m).toLowerCase()
      // letters + digits (e.g. "zt-b50800d2-10p"), or a long all-digit number (AMD "100-000000926")
      const usable = (k.length >= 6 && /[a-z]/.test(k) && /\d/.test(k)) || /^\d{10,}$/.test(k)
      if (!usable) continue
      const cur = keys.get(k)
      keys.set(k, cur === undefined || cur === id ? id : null)
    }
  }
  for (const [k, v] of keys) if (v === null) keys.delete(k)
  return keys
}

/**
 * PCX style: the URL slug ends with the part number, before a trailing "-<shop id>".
 * Returns { partId, key }, longest matching key wins.
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

/**
 * Generic: looks for a known part number anywhere in the URL path, as 1–6 consecutive
 * words ("…-gt-710-2gd3h-lp/pd/…" → "gt7102gd3hlp"). Longest match wins.
 */
export function matchUrlTokens(url, keys) {
  let path
  try {
    path = decodeURIComponent(new URL(url).pathname).toLowerCase()
  } catch {
    return null
  }
  const tokens = path.split(/[^a-z0-9]+/).filter(Boolean)
  let best = null
  for (let i = 0; i < tokens.length; i++) {
    let joined = ''
    for (let j = i; j < Math.min(tokens.length, i + 6); j++) {
      joined += tokens[j]
      if (joined.length < 6) continue
      const partId = keys.get(joined)
      if (partId && (!best || joined.length > best.key.length)) best = { partId, key: joined }
    }
  }
  return best
}

/**
 * Does the product page really describe this part? Its MPN or EAN must belong to it.
 * (URL matching only picks which pages to fetch; this is the actual check.)
 */
export function pageConfirmsPart(identifiers, partId, page) {
  const ids = identifiers[partId]
  if (!ids || !page) return false
  if (page.mpn && (ids.mpn ?? []).some((m) => normalizeMpn(m) === normalizeMpn(page.mpn))) return true
  const ean = normalizeEan(page.gtin)
  if (ean && (ids.ean ?? []).some((e) => normalizeEan(e) === ean)) return true
  return false
}
