// Manual price source: data/offers/manual.csv, edited by hand.
// Also the fallback when no automatic source is allowed yet.
//
// Columns: shop,priceHuf,mpn,ean,partId,url
//   - at least one of mpn / ean / partId must be filled
//   - priceHuf: whole forints, no spaces ("54990")

import fs from 'node:fs'
import path from 'node:path'

export const name = 'manual'

/** Minimal CSV parser: comma separated, double-quoted fields may contain commas and "" escapes. */
export function parseCsv(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const cells = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') (cur += '"'), i++
        else if (c === '"') quoted = false
        else cur += c
      } else if (c === '"') quoted = true
      else if (c === ',') cells.push(cur), (cur = '')
      else cur += c
    }
    cells.push(cur)
    rows.push(cells.map((s) => s.trim()))
  }
  const [header, ...body] = rows
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

/** @returns {Promise<import('../lib.mjs').Offer[]>} */
export async function fetchOffers({ root }) {
  const file = path.join(root, 'data/offers/manual.csv')
  if (!fs.existsSync(file)) return []
  return parseCsv(fs.readFileSync(file, 'utf8')).map((r) => ({
    source: name,
    shop: r.shop,
    priceHuf: Number(r.priceHuf),
    mpn: r.mpn || undefined,
    ean: r.ean || undefined,
    partId: r.partId || undefined,
    url: r.url || undefined,
  }))
}
