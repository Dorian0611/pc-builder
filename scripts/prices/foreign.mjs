// Foreign shop prices → an estimate of the Hungarian price (never shown as a real price).
//
// 1. each foreign offer is converted to HUF with Hungarian VAT (fx.mjs);
// 2. per part: median over the foreign shops (one price per shop);
// 3. calibration: Hungarian and foreign markets differ (distribution, margins), so per
//    category we take the median ratio "Hungarian shop price / converted foreign price"
//    over the parts that have both, and the site multiplies the foreign median by it.

import { aggregate, median } from './lib.mjs'

/** Fewer parts with both prices than this → use the all-category ratio instead. */
export const MIN_OVERLAP = 8
/** Ratios outside this range are treated as data problems and clamped. */
export const FACTOR_RANGE = [0.7, 1.6]

const clamp = (x) => Math.min(FACTOR_RANGE[1], Math.max(FACTOR_RANGE[0], x))
const round3 = (x) => Math.round(x * 1000) / 1000

/**
 * @param {Record<string, {medianHuf: number}>} domestic  Hungarian prices (prices.json)
 * @param {Record<string, {medianHuf: number}>} foreign   converted foreign medians
 * @param {(partId: string) => string | undefined} categoryOf
 * @returns {{ factors: Record<string, number>, overlaps: Record<string, number> }}
 *   factors["*"] is the all-category ratio (1 when there is too little data)
 */
export function calibrate(domestic, foreign, categoryOf) {
  /** @type {Record<string, number[]>} */
  const ratios = { '*': [] }
  for (const [id, f] of Object.entries(foreign)) {
    const d = domestic[id]
    if (!d || !(f.medianHuf > 0)) continue
    const r = d.medianHuf / f.medianHuf
    const cat = categoryOf(id) ?? '?'
    ;(ratios[cat] ??= []).push(r)
    ratios['*'].push(r)
  }
  const overall = ratios['*'].length >= MIN_OVERLAP ? clamp(median(ratios['*'])) : 1
  const factors = { '*': round3(overall) }
  const overlaps = {}
  for (const [cat, rs] of Object.entries(ratios)) {
    overlaps[cat] = rs.length
    if (cat !== '*') factors[cat] = round3(rs.length >= MIN_OVERLAP ? clamp(median(rs)) : overall)
  }
  return { factors, overlaps }
}

/**
 * Builds public/data/foreign-prices.json.
 * @param {{ partId: string, offer: import('./lib.mjs').Offer }[]} matched  converted foreign offers
 */
export function buildForeignFile(matched, domestic, categoryOf, today, rateDate) {
  const items = aggregate(matched, today)
  for (const p of Object.values(items)) delete p.links // the site doesn't link foreign shops
  const { factors, overlaps } = calibrate(domestic, items, categoryOf)
  return { updatedAt: today, rateDate, factors, overlaps, items }
}
