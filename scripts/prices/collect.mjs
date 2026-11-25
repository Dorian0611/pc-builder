// Runs ONE price source and writes its offers to a file (one GitHub Actions job per shop).
//
//   node scripts/prices/collect.mjs --source ipon --out offers/ipon.json
//
// The file is always written, also when the source fails part-way:
//   { source, ok, error?, offers: Offer[], finishedAt }
// Exit code 1 on failure, so the job shows red; the aggregate job still uses the partial offers.

import fs from 'node:fs'
import path from 'node:path'
import { SOURCES } from './sources/index.mjs'

const arg = (flag) => {
  const i = process.argv.indexOf(flag)
  return i > 0 ? process.argv[i + 1] : undefined
}
const sourceName = arg('--source')
const out = arg('--out') ?? `offers/${sourceName}.json`
const source = SOURCES[sourceName]
if (!source) {
  console.error(`Unknown source "${sourceName}". Known: ${Object.keys(SOURCES).join(', ')}`)
  process.exit(2)
}

const root = path.resolve(import.meta.dirname, '../..')
const identifiers = JSON.parse(fs.readFileSync(path.join(root, 'data/part-identifiers.json'), 'utf8'))

let result
try {
  // optional limits for quick diagnostic runs (workflow_dispatch inputs)
  const maxPages = Number(process.env.MAX_PAGES) || Infinity
  const offers = await source.fetchOffers({ root, identifiers, maxProductPages: maxPages, maxPages, maxSitemaps: Number(process.env.MAX_SITEMAPS) || Infinity })
  result = { source: sourceName, ok: true, offers }
} catch (e) {
  console.error(`${sourceName}: HIBA – ${e instanceof Error ? e.message : e}`)
  result = { source: sourceName, ok: false, error: String(e?.message ?? e), offers: Array.isArray(e?.partialOffers) ? e.partialOffers : [] }
}
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ ...result, finishedAt: new Date().toISOString() }))
console.log(`${sourceName}: ${result.offers.length} offers → ${out}`)
if (!result.ok) process.exit(1)
