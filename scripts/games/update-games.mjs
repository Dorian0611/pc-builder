// Current popular games and their hardware demand → public/data/games.json
//
// Source: Steam's public "most played" chart (api.steampowered.com, no key needed) and each
// game's store requirements (store.steampowered.com/api/appdetails, allowed by robots.txt).
// Polite: identifying User-Agent, one request every 1.5 s, at most ~100 requests a run.
// Games we can't read requirements for are skipped. data/games-manual.json adds games that are
// not on Steam (yet), e.g. GTA VI – those are marked as estimates on the site.
//
// Usage: node scripts/games/update-games.mjs [--max 40]

import fs from 'node:fs'
import path from 'node:path'
import { get, sleep } from '../prices/http.mjs'
import { demandFromRequirements } from './requirements.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const arg = (name, def) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : def
}
const MAX_GAMES = Number(arg('--max', 40))
const DELAY_MS = 1500

const cpuScores = JSON.parse(fs.readFileSync(path.join(root, 'data/cpu-scores.json'), 'utf8'))
const manual = JSON.parse(fs.readFileSync(path.join(root, 'data/games-manual.json'), 'utf8'))
// entries with a Steam id override what we read from the store (useless official specs, e.g. CS2);
// the others (not on Steam yet) are always listed
const overrides = new Map(manual.filter((g) => g.steamAppId).map((g) => [g.steamAppId, g]))
const always = manual.filter((g) => !g.steamAppId)
/** Below this GPU demand the game runs on anything – not useful for upgrade advice. */
const LIGHT_GPU = 25
const SOFTWARE_GENRES = /Utilities|Software Training|Design & Illustration|Animation & Modeling|Video Production|Audio Production|Photo Editing|Web Publishing/i

async function json(url) {
  const res = await get(url, { accept: 'application/json' })
  if (!res.body) throw new Error(`${url}: HTTP ${res.status}${res.error ? ' ' + res.error : ''}`)
  return JSON.parse(res.body)
}

const chart = await json('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/')
const ranks = chart?.response?.ranks ?? []
if (ranks.length === 0) throw new Error('Steam chart: empty response')

const games = []
let skipped = 0
for (const r of ranks) {
  if (games.length >= MAX_GAMES) break
  await sleep(DELAY_MS)
  let data
  try {
    const res = await json(`https://store.steampowered.com/api/appdetails?appids=${r.appid}&l=english&cc=hu`)
    data = res?.[r.appid]?.data
  } catch (e) {
    console.log(`  ${r.appid}: ${e.message}`)
    skipped++
    continue
  }
  // Steam lists some tools as games (Wallpaper Engine): its software genres give them away
  const software = (data?.genres ?? []).some((g) => SOFTWARE_GENRES.test(g.description ?? ''))
  if (!data || data.type !== 'game' || !data.platforms?.windows || software) {
    skipped++
    continue
  }
  const override = overrides.get(r.appid)
  if (override) {
    games.push({ ...override, rank: r.rank })
    console.log(`  #${r.rank} ${override.name}: CPU ${override.cpu} · GPU ${override.gpu} (kézi becslés)`)
    continue
  }
  const demand = demandFromRequirements(data.pc_requirements, cpuScores)
  if (demand && demand.gpu < LIGHT_GPU) {
    console.log(`  ${data.name}: runs on anything, skipped`)
    skipped++
    continue
  }
  if (!demand) {
    console.log(`  ${data.name}: no readable GPU requirement, skipped`)
    skipped++
    continue
  }
  games.push({
    id: `steam-${r.appid}`,
    name: data.name.replace(/[™®]/g, ''),
    steamAppId: r.appid,
    rank: r.rank,
    cpu: demand.cpu,
    gpu: demand.gpu,
    basis: demand.basis,
    cpuText: demand.cpuText,
    gpuText: demand.gpuText,
  })
  console.log(`  #${r.rank} ${data.name}: CPU ${demand.cpu ?? '?'} · GPU ${demand.gpu} (${demand.basis})`)
}

if (games.length < 10) throw new Error(`only ${games.length} games could be read – keeping the old list`)

const out = {
  updatedAt: new Date().toISOString().slice(0, 10),
  source: 'Steam – legtöbbet játszott játékok',
  games: [...always, ...games],
}
fs.writeFileSync(path.join(root, 'public/data/games.json'), JSON.stringify(out, null, 1) + '\n')
console.log(`játékok: ${games.length} a Steamről + ${always.length} kézi, ${skipped} kihagyva`)
