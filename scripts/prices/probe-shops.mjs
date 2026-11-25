// Checks whether shops can be price sources under the project rule:
//   robots.txt allows it AND the site serves our identified bot (from wherever this runs –
//   run it on GitHub Actions, see .github/workflows/probe-shops.yml) without a CAPTCHA,
//   bot check or block, AND product pages carry machine-readable prices (any currency –
//   foreign shops feed the "estimated from foreign prices" figure).
//
//   node scripts/prices/probe-shops.mjs aqua.hu www.pcx.hu …
//
// Per shop: robots.txt, homepage, sitemap → up to 6 product pages in a row (some sites only
// switch to a CAPTCHA after the first request). Polite: one request at a time, 3 s apart.

import { Blocked, get, isSitemapIndex, parseProductJsonLd, robotsAllows, sitemapLocs, sleep } from './http.mjs'

const DELAY = 3000
const PAGES = 6
/** URLs that look like PC components, preferred when picking sample product pages. */
const PC_WORDS = /rtx|geforce|radeon|ryzen|core-?i[3579]|intel-core|core-ultra|videokartya|grafikkarte|karta-graficzna|graficka|processzor|prozessor|procesor|alaplap|mainboard|ssd|nvme|ddr[45]|tapegyseg|netzteil|cpu/i
const NOT_PRODUCT = /\/(kategoria|category|csoport|marka|brand|blog|cikk|hirek|news|tag|kereses|search|static|info|aszf)\b|\.(jpg|png|webp|pdf)$/i

async function fetchText(url) {
  try {
    return await get(url)
  } catch (e) {
    if (e instanceof Blocked) return { status: -1, body: null, blocked: e.message }
    return { status: 0, body: null, error: String(e?.message ?? e) }
  }
}

async function probe(domain) {
  const base = `https://${domain}`
  const row = { shop: domain, robots: '?', home: '?', sitemap: '?', pages: '?', verdict: '' }
  const say = (verdict) => ((row.verdict = verdict), row)

  const robots = await fetchText(`${base}/robots.txt`)
  if (robots.blocked) return say(`❌ blocks the bot (${robots.blocked.split(' – ')[0]})`)
  const robotsTxt = robots.body ?? ''
  const allAllowed = robotsAllows(robotsTxt, '/')
  row.robots = robots.status === 200 ? (allAllowed ? 'allows' : 'disallows /') : `HTTP ${robots.status}`
  if (robots.status === 200 && !allAllowed) return say('❌ robots.txt disallows everything')

  await sleep(DELAY)
  const home = await fetchText(base + '/')
  if (home.blocked) return say(`❌ blocks the bot on the homepage`)
  row.home = home.body ? `HTTP ${home.status}` : `HTTP ${home.status} ${home.error ?? ''}`
  if (!home.body) return say('❌ homepage not served to the bot')

  // sitemap: robots.txt "Sitemap:" lines, else /sitemap.xml
  const declared = [...robotsTxt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1])
  let queue = declared.length ? declared : [`${base}/sitemap.xml`]
  const productUrls = []
  let sitemapsRead = 0
  while (queue.length && sitemapsRead < 8 && productUrls.length < 5000) {
    const sm = queue.shift()
    await sleep(DELAY)
    const res = await fetchText(sm)
    sitemapsRead++
    if (res.blocked) return say('❌ blocks the bot on the sitemap')
    if (!res.body) continue
    const locs = sitemapLocs(res.body)
    if (isSitemapIndex(res.body)) {
      // product sitemaps first
      const kids = locs.sort((a, b) => Number(/prod|termek|item|offer/i.test(b)) - Number(/prod|termek|item|offer/i.test(a)))
      queue = [...kids, ...queue]
    } else {
      productUrls.push(...locs.filter((u) => u.startsWith(base) || u.includes(domain.replace(/^www\./, ''))).filter((u) => !NOT_PRODUCT.test(u)))
    }
  }
  row.sitemap = productUrls.length ? `${productUrls.length}${productUrls.length >= 5000 ? '+' : ''} URLs (${sitemapsRead} files)` : 'none found'
  if (!productUrls.length) return say('⚠️ no usable sitemap (would need a shop-specific listing crawler)')

  // sample product pages, PC-looking ones first
  const pcLike = productUrls.filter((u) => PC_WORDS.test(u))
  const sample = [...pcLike, ...productUrls].filter((u, i, a) => a.indexOf(u) === i).slice(0, PAGES)
  let withPrice = 0
  const currencies = new Set()
  let withIds = 0
  let challenged = 0
  let failed = 0
  const examples = []
  for (const url of sample) {
    await sleep(DELAY)
    const res = await fetchText(url)
    if (res.blocked) {
      challenged++
      break // stop at the first CAPTCHA / bot block
    }
    if (!res.body) {
      failed++
      continue
    }
    const p = parseProductJsonLd(res.body)
    if (p && p.currency && Number.isFinite(p.priceHuf)) {
      withPrice++
      currencies.add(p.currency)
      if (p.mpn || p.gtin) withIds++
      if (examples.length < 2) examples.push(`${(p.name ?? '').slice(0, 40)} | ${p.priceHuf} ${p.currency} | mpn ${p.mpn ?? '-'} | gtin ${p.gtin ?? '-'}${p.condition ? ` | ${p.condition}` : ''}`)
    }
  }
  row.pages = `${sample.length} tried: ${withPrice} with price [${[...currencies].join(',')}], ${withIds} with MPN/EAN, ${failed} failed${challenged ? ', CAPTCHA/BLOCK' : ''}`
  row.examples = examples
  if (challenged) return say('❌ CAPTCHA / bot block on product pages')
  if (withIds === 0) return say(withPrice ? '⚠️ prices but no MPN/EAN to match' : '⚠️ no machine-readable prices on product pages')
  return say('✅ usable')
}

const domains = process.argv.slice(2)
if (!domains.length) {
  console.error('usage: node scripts/prices/probe-shops.mjs shop1.hu www.shop2.hu …')
  process.exit(2)
}
const rows = []
for (const d of domains) {
  const r = await probe(d)
  rows.push(r)
  console.log(`\n${r.verdict}  ${r.shop}\n  robots: ${r.robots} | home: ${r.home} | sitemap: ${r.sitemap}\n  pages: ${r.pages}`)
  for (const e of r.examples ?? []) console.log(`    e.g. ${e}`)
}
console.log('\nSUMMARY')
for (const r of rows) console.log(`${r.verdict.padEnd(60)} ${r.shop}`)
