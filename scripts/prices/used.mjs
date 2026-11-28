// Used-market prices: what a part sells for second-hand, for parts no Hungarian shop sells
// new any more. Classified ads rarely carry part numbers, so we work on the level that
// decides a used price anyway: the processor model ("Ryzen 5 3600") and the graphics chip
// ("RTX 3070"), not the exact board-partner card.
//
// Only titles and prices are used; nothing about the sellers is kept. The site shows the
// median per model with the number of ads behind it.

import { parseGpus } from '../games/requirements.mjs'

/** Not a single used part for sale. */
const SKIP =
  /\b(veszek|keresek|keresem|csere|cserél|beszámít)|\bkeres\b|bontatlan|\búj\b|hibás|nem működ|alkatrésznek|defekt|sérült|\bpc\b|számítógép|konfig|gép\b|komplett|csomag|szett|notebook|laptop|\+/i

/** Distinct CPU models named in a text (each candidate span read on its own). */
export function cpuModelCount(text, cpuKeyOf) {
  const spans = String(text).match(/\b(?:core\s*)?i[3579][\s-]*\d{4,5}[a-z]{0,2}\b|ryzen\s*[3579]\s*(?:pro\s*)?\d{4}[a-z0-9]{0,3}\b|\bfx[\s-]*\d{4}\b|ultra\s*[3579]\s*\d{3}[a-z]{0,2}\b/gi) ?? []
  return new Set(spans.map((s) => cpuKeyOf(s)).filter(Boolean)).size
}

/** "9 000 Ft" → 9000; "Keresem" / "Ingyen" → undefined */
export function parseHuf(text) {
  const m = String(text).replace(/\s|&nbsp;/g, ' ').match(/(\d[\d ]*)\s*Ft/)
  if (!m) return undefined
  const n = Number(m[1].replace(/ /g, ''))
  return n > 0 ? n : undefined
}

/**
 * What a used ad is about, or undefined when it is not one used CPU / graphics card.
 * @param {string} title
 * @param {(s: string) => string | undefined} cpuKeyOf  perf.mjs cpuNameKey
 * @returns {{ kind: 'cpu', key: string } | { kind: 'gpu', key: string } | undefined}
 */
export function usedKeyOf(title, cpuKeyOf) {
  if (SKIP.test(title)) return undefined
  // "i5-6500 -i5-7400 -i5-7500", "i7-8700 / i5-9500 / i3-9100": several models, one price
  if (cpuModelCount(title, cpuKeyOf) > 1) return undefined
  const cpu = cpuKeyOf(title)
  const gpus = parseGpus(title)
  if (cpu && gpus.length === 0) return { kind: 'cpu', key: cpu }
  // exactly one chip – "RTX 3070 vagy RX 6800" is not one card
  if (!cpu && gpus.length === 1) return { kind: 'gpu', key: gpus[0].name }
  return undefined
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Fewer ads than this → no used price (one optimistic seller is not a market). */
export const MIN_ADS = 3

/**
 * Median price per model/chip, after dropping ads far from the first median
 * (typos, bundles that slipped through, "1 Ft" teasers).
 * @param {{ kind: string, key: string, priceHuf: number }[]} ads
 * @returns {Map<string, { medianHuf: number, minHuf: number, count: number }>} keyed "cpu:…" / "gpu:…"
 */
export function aggregateUsed(ads) {
  const groups = new Map()
  for (const a of ads) {
    const k = `${a.kind}:${a.key}`
    ;(groups.get(k) ?? groups.set(k, []).get(k)).push(a.priceHuf)
  }
  const out = new Map()
  for (const [k, prices] of groups) {
    const m0 = median(prices)
    const kept = prices.filter((p) => p >= m0 / 2 && p <= m0 * 2)
    if (kept.length < MIN_ADS) continue
    out.set(k, { medianHuf: median(kept), minHuf: Math.min(...kept), count: kept.length })
  }
  return out
}

/**
 * Model/chip prices → our parts: every CPU with that model, every graphics card with that
 * chip (the table's "GeForce RTX 3060" covers the "… 12 GB" and "… 8 GB" variants).
 * @param {Map<string, { medianHuf: number, minHuf: number, count: number }>} prices
 * @param {{ id: string, brand: string, name: string }[]} cpus
 * @param {{ id: string, chip?: string }[]} gpus
 */
export function usedPricesByPart(prices, cpus, gpus, cpuKeyOf) {
  const out = {}
  for (const c of cpus) {
    const p = prices.get(`cpu:${cpuKeyOf(`${c.brand} ${c.name}`)}`)
    if (p) out[c.id] = p
  }
  for (const g of gpus) {
    if (!g.chip) continue
    const p = prices.get(`gpu:${g.chip}`) ?? prices.get(`gpu:${g.chip.replace(/ (\d+ GB|LHR)$/, '')}`)
    if (p) out[g.id] = p
  }
  return out
}
