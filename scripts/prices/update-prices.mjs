// Nightly price update.
//
//   node scripts/prices/update-prices.mjs [--date YYYY-MM-DD]
//
// 1. every enabled source returns offers
// 2. offers are matched to parts by EAN / manufacturer part number
// 3. per part: median, minimum, number of shops
// 4. merged over the previous public/data/prices.json (last good price stays)
// 5. changed prices are appended to data/price-history/YYYY-MM.csv
//
// A failing source does not stop the others; the script exits with code 1 at the
// end so the scheduled GitHub workflow fails and GitHub sends an e-mail.

import fs from 'node:fs'
import path from 'node:path'
import { aggregate, buildIndex, historyRows, isValidOffer, matchOffer, mergePrices } from './lib.mjs'
import * as manual from './sources/manual.mjs'
import * as pcx from './sources/pcx.mjs'

/** Enabled sources. Árukereső / Árgép only once they give permission. */
const SOURCES = [manual, pcx]

const root = path.resolve(import.meta.dirname, '../..')
const dateArg = process.argv.indexOf('--date')
const today = dateArg > 0 ? process.argv[dateArg + 1] : new Date().toISOString().slice(0, 10)

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback)

const identifiers = readJson(path.join(root, 'data/part-identifiers.json'), null)
if (!identifiers) {
  console.error('data/part-identifiers.json hiányzik – futtasd előbb az OpenDB importálót.')
  process.exit(1)
}
const index = buildIndex(identifiers)

const failures = []
const matched = []
for (const source of SOURCES) {
  try {
    const offers = await source.fetchOffers({ root, today, identifiers })
    let ok = 0
    let unmatched = 0
    let invalid = 0
    for (const offer of offers) {
      if (!isValidOffer(offer)) {
        invalid++
        continue
      }
      const partId = matchOffer(index, offer)
      if (!partId) {
        unmatched++
        continue
      }
      matched.push({ partId, offer })
      ok++
    }
    console.log(`${source.name}: ${offers.length} ajánlat, ${ok} párosítva, ${unmatched} nem párosítható, ${invalid} érvénytelen`)
  } catch (e) {
    failures.push(source.name)
    console.error(`${source.name}: HIBA – ${e instanceof Error ? e.message : e}`)
  }
}

const pricesFile = path.join(root, 'public/data/prices.json')
const previous = readJson(pricesFile, {})
const fresh = aggregate(matched, today)
const next = mergePrices(previous, fresh, today)

// stable key order → small, readable git diffs
const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]))
fs.writeFileSync(pricesFile, JSON.stringify(sorted, null, 0) + '\n')

const rows = historyRows(previous, next, today)
if (rows.length) {
  const histDir = path.join(root, 'data/price-history')
  fs.mkdirSync(histDir, { recursive: true })
  const histFile = path.join(histDir, `${today.slice(0, 7)}.csv`)
  if (!fs.existsSync(histFile)) fs.writeFileSync(histFile, 'date,partId,medianHuf,minHuf,offerCount\n')
  fs.appendFileSync(histFile, rows.join('\n') + '\n')
}

const flagged = Object.values(next).filter((p) => p.flag === 'jump').length
const kept = Object.values(next).filter((p) => p.updatedAt !== today).length
console.log(
  `\nárak: ${Object.keys(next).length} termék (${Object.keys(fresh).length} friss, ${kept} korábbi), ` +
    `${rows.length} változás, ${flagged} gyanús ugrás`,
)

if (failures.length) {
  console.error(`Sikertelen források: ${failures.join(', ')}`)
  process.exit(1)
}
