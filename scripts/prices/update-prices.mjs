// Price update (scheduled twice a month).
//
//   node scripts/prices/update-prices.mjs [--date YYYY-MM-DD] [--offers-dir offers]
//
// Without --offers-dir every source runs here, one after another (handy locally).
// With it, the offers collected by the per-shop jobs (scripts/prices/collect.mjs) are used.
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
import { SOURCES } from './sources/index.mjs'
import { fetchEcbRates, toHungarianGross } from './fx.mjs'
import { calibrate } from './foreign.mjs'
import { aggregateUsed, usedPricesByPart } from './used.mjs'
import { cpuNameKey } from '../perf.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const dateArg = process.argv.indexOf('--date')
const today = dateArg > 0 ? process.argv[dateArg + 1] : new Date().toISOString().slice(0, 10)
const dirArg = process.argv.indexOf('--offers-dir')
const offersDir = dirArg > 0 ? path.resolve(process.argv[dirArg + 1]) : undefined

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback)

const identifiers = readJson(path.join(root, 'data/part-identifiers.json'), null)
if (!identifiers) {
  console.error('data/part-identifiers.json hiányzik – futtasd előbb az OpenDB importálót.')
  process.exit(1)
}
const index = buildIndex(identifiers)

const failures = []
const matched = []
/** foreign shop offers, converted to HUF – they only feed the estimate (foreign-prices.json) */
const foreignMatched = []
/** used-market ads per CPU model / GPU chip (sources that export `used = true`) – used-prices.json */
const usedAds = []
const usedSources = new Set()

let ecb
/** Foreign sources export `foreign = { country, currency }`; their offers carry the original price. */
async function toHuf(offer, foreign) {
  ecb ??= await fetchEcbRates()
  return { ...offer, priceHuf: toHungarianGross(offer.priceOrig, foreign.currency, foreign.country, ecb.rates) }
}

async function useOffers(sourceName, offers, foreign, used) {
  if (used) {
    usedAds.push(...offers.filter((o) => o.kind && o.key && o.priceHuf > 0))
    usedSources.add(sourceName.split(' ')[0])
    console.log(`${sourceName} (használt piac): ${offers.length} hirdetés`)
    return
  }
  let ok = 0
  let unmatched = 0
  let invalid = 0
  for (let offer of offers) {
    if (foreign) {
      if (!(offer.priceOrig > 0)) {
        invalid++
        continue
      }
      offer = await toHuf(offer, foreign)
    }
    if (!isValidOffer(offer)) {
      invalid++
      continue
    }
    const partId = matchOffer(index, offer)
    if (!partId) {
      unmatched++
      continue
    }
    ;(foreign ? foreignMatched : matched).push({ partId, offer })
    ok++
  }
  console.log(`${sourceName}${foreign ? ` (külföldi, ${foreign.country})` : ''}: ${offers.length} ajánlat, ${ok} párosítva, ${unmatched} nem párosítható, ${invalid} érvénytelen`)
}

if (offersDir) {
  // offers collected by the per-shop jobs; a missing file = that job did not finish
  for (const name of Object.keys(SOURCES)) {
    const file = path.join(offersDir, `${name}.json`)
    const r = readJson(file, null)
    if (!r) {
      failures.push(name)
      console.error(`${name}: nincs ajánlatfájl (${file})`)
      continue
    }
    if (!r.ok) {
      failures.push(name)
      console.error(`${name}: HIBA – ${r.error}`)
    }
    try {
      await useOffers(r.ok ? name : `${name} (részleges)`, r.offers ?? [], SOURCES[name].foreign, SOURCES[name].used)
    } catch (e) {
      // e.g. ECB rates unavailable: this source is lost for today, the others still count
      failures.push(name)
      console.error(`${name}: HIBA – ${e instanceof Error ? e.message : e}`)
    }
  }
} else {
  for (const source of Object.values(SOURCES)) {
    try {
      await useOffers(source.name, await source.fetchOffers({ root, today, identifiers }), source.foreign, source.used)
    } catch (e) {
      failures.push(source.name)
      console.error(`${source.name}: HIBA – ${e instanceof Error ? e.message : e}`)
      // a source may still hand back what it collected before the problem
      if (Array.isArray(e?.partialOffers) && e.partialOffers.length) await useOffers(`${source.name} (részleges)`, e.partialOffers, source.foreign, source.used)
    }
  }
}

const pricesFile = path.join(root, 'public/data/prices.json')
const previous = readJson(pricesFile, {})
const fresh = aggregate(matched, today)
const next = mergePrices(previous, fresh, today)

// stable key order → small, readable git diffs
const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]))
fs.writeFileSync(pricesFile, JSON.stringify(sorted, null, 0) + '\n')

// ---- foreign prices → estimate file (kept apart from the real Hungarian prices)
const foreignFile = path.join(root, 'public/data/foreign-prices.json')
const prevForeign = readJson(foreignFile, { items: {} })
const hasForeignSources = Object.values(SOURCES).some((src) => src.foreign)
if (hasForeignSources || Object.keys(prevForeign.items ?? {}).length) {
  const categoryOf = (() => {
    const map = new Map()
    for (const cat of ['cpu', 'motherboard', 'memory', 'gpu', 'storage', 'psu', 'case', 'cooler']) {
      const f = path.join(root, `public/data/${cat}.json`)
      if (fs.existsSync(f)) for (const part of JSON.parse(fs.readFileSync(f, 'utf8'))) map.set(part.id, cat)
    }
    return (id) => map.get(id)
  })()
  const freshForeign = aggregate(foreignMatched, today)
  for (const f of Object.values(freshForeign)) delete f.links // foreign shops are not linked on the site
  const items = mergePrices(prevForeign.items ?? {}, freshForeign, today)
  const { factors, overlaps } = calibrate(next, items, categoryOf)
  const sortedItems = Object.fromEntries(Object.keys(items).sort().map((k) => [k, items[k]]))
  fs.writeFileSync(
    foreignFile,
    JSON.stringify({ updatedAt: today, rateDate: ecb?.date ?? prevForeign.rateDate, factors, overlaps, items: sortedItems }) + '\n',
  )
  console.log(
    `külföldi árak: ${Object.keys(items).length} termék (${Object.keys(freshForeign).length} friss), ` +
      `kalibráció: ${Object.entries(factors).map(([k, v]) => `${k}=${v} (${overlaps[k] ?? 0})`).join(', ')}`,
  )
}

// ---- used-market prices (kept apart: shown only for parts with no new price)
const usedFile = path.join(root, 'public/data/used-prices.json')
const prevUsed = readJson(usedFile, { items: {} })
if (usedAds.length || Object.keys(prevUsed.items ?? {}).length) {
  const load = (cat) => readJson(path.join(root, `public/data/${cat}.json`), [])
  const byPart = usedPricesByPart(aggregateUsed(usedAds), load('cpu'), load('gpu'), cpuNameKey)
  const fresh = Object.fromEntries(
    Object.entries(byPart).map(([id, p]) => [
      id,
      { medianHuf: p.medianHuf, minHuf: p.minHuf, offerCount: p.count, updatedAt: today, sources: [...usedSources] },
    ]),
  )
  const items = mergePrices(prevUsed.items ?? {}, fresh, today)
  const sortedItems = Object.fromEntries(Object.keys(items).sort().map((k) => [k, items[k]]))
  fs.writeFileSync(usedFile, JSON.stringify({ updatedAt: today, items: sortedItems }) + '\n')
  console.log(`használt árak: ${Object.keys(items).length} alkatrész (${Object.keys(fresh).length} friss, ${usedAds.length} hirdetésből)`)
}

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
