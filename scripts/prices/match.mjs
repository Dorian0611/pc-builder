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

// ---------------------------------------------------------------- part numbers inside names

/** A part number counts on its own only if it is this long (normalized) … */
const MIN_MPN_IN_NAME = 6
/** … and one without digits only as a phrase of 3+ words at least this long ("OBSERVATORY HF GW"). */
const MIN_WORDY_MPN = 10
const MIN_WORDY_WORDS = 3
const MAX_GRAM_WORDS = 7

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
/** Brands that shops often write differently. */
const BRAND_ALIASES = {
  westerndigital: ['wd'],
  adata: ['xpg'],
  xpg: ['adata'],
  teamgroup: ['team', 'tforce'],
  gskill: ['gskill', 'g.skill'],
  fspgroup: ['fsp'],
  coolermaster: ['coolermaster'],
  hewlettpackard: ['hp'],
}

/** Does the shop's product name mention the part's brand? */
export function nameHasBrand(name, brand) {
  const n = squash(name)
  const b = squash(brand)
  if (!b) return true
  if (n.includes(b)) return true
  const first = squash(String(brand).split(/[\s-]+/)[0])
  if (first.length >= 3 && n.includes(first)) return true
  return (BRAND_ALIASES[b] ?? []).some((a) => n.includes(squash(a)))
}

/** Accessories and other things that carry a part's code but are not the part. */
export const ACCESSORY =
  /előlap|kiegészítő|\bmodul\b|kábel|adapter|tartó|rögzítő|keret|bővítő|hosszabbító|elosztó|router|extender|mesh networking|switch|webkamera|egér|billentyű|cable|bracket|front panel|riser/i

/**
 * Finds an OpenDB part number anywhere in a shop's product name, as a run of whole words:
 * "MSI Videokártya … RTX 5060 8G VENTUS 2X OC V1" contains "RTX 5060 8G VENTUS 2X OC".
 * The longest matching run wins ("B650M D3HP AX" over "B650M D3HP"); if that longest
 * one belongs to several parts, there is no match – never a guess.
 * The part's brand has to appear in the name too, and a "part number" that is just the
 * brand (an OpenDB data slip: "Cooler Master") is ignored.
 * @param {string} name
 * @param {{ mpn: Map<string, string | null> }} index  buildIndex()
 * @param {(id: string) => string | undefined} brandOf
 * @returns {string | undefined} part id
 */
export function matchMpnInName(name, index, brandOf) {
  if (ACCESSORY.test(name)) return undefined
  const words = String(name).split(/[\s,;()[\]"]+/).filter(Boolean)
  let best = { len: 0, id: /** @type {string | null | undefined} */ (undefined) }
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= MAX_GRAM_WORDS && i + n <= words.length; n++) {
      const key = normalizeMpn(words.slice(i, i + n).join(' '))
      if (key.length < MIN_MPN_IN_NAME || key.length <= best.len) continue
      if (!/\d/.test(key) && (n < MIN_WORDY_WORDS || key.length < MIN_WORDY_MPN)) continue
      const id = index.mpn.get(key)
      if (id === undefined) continue
      if (id !== null) {
        const brand = brandOf(id)
        if (brand && (normalizeMpn(brand) === key || !nameHasBrand(name, brand))) continue
      }
      best = { len: key.length, id } // null = ambiguous: kept, so a shorter run can't win
    }
  }
  return best.id ?? undefined
}

/**
 * CPUs by model ("Intel Core i3-13100 3,4GHz … OEM CM8071505092202" → "i3 13100"), for shops
 * that list tray codes OpenDB doesn't have. Only models that map to exactly one part.
 * @param {{ id: string, brand: string, name: string }[]} cpus  public/data/cpu.json
 * @param {(name: string) => string | undefined} keyOf  perf.mjs cpuNameKey
 */
export function cpuModelIndex(cpus, keyOf) {
  const map = new Map()
  for (const c of cpus) {
    const key = keyOf(`${c.brand} ${c.name}`)
    if (!key) continue
    map.set(key, map.has(key) && map.get(key) !== c.id ? null : c.id)
  }
  return map
}

/** Words that mark a CPU listing (and not, say, a CPU cooler or a board "for i5-…"). */
const NOT_A_CPU =
  /hűtő|cooler|alaplap|motherboard|keret|frame|paszta|paste|notebook|laptop|bracket|számítógép|all-in-one|optiplex|thinkcentre|prodesk|mini ?pc|szerver|server/i

export function matchCpuModel(name, cpuIndex, keyOf) {
  if (NOT_A_CPU.test(name)) return undefined
  const key = keyOf(name)
  return (key && cpuIndex.get(key)) || undefined
}
