// BuildCores OpenDB → saját adatmodell (public/data/*.json)
//
// Használat:  node scripts/import-opendb.mjs <opendb-mappa>
//   pl.       node scripts/import-opendb.mjs vendor/opendb
//
// Az OpenDB adatai CC BY-NC-SA 4.0 licencűek. A kimenet ezek szűrt, átalakított
// részhalmaza, ezért ugyanilyen licenccel tesszük közzé (lásd public/data/README.md).

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.argv[2]
if (!root) {
  console.error('Használat: node scripts/import-opendb.mjs <opendb-mappa>')
  process.exit(1)
}
const dbDir = path.join(root, 'open-db')
const outDir = path.resolve('public/data')
fs.mkdirSync(outDir, { recursive: true })

// ---------------------------------------------------------------- segédek

const SOCKETS = new Set(['AM4', 'AM5', 'LGA 1151', 'LGA 1200', 'LGA 1700', 'LGA 1851'])

const BOARD_FF = { ATX: 'ATX', 'Micro ATX': 'mATX', 'Mini-ITX': 'ITX', EATX: 'E-ATX' }
const PSU_FF = { ATX: 'ATX', 'ATX/EPS': 'ATX', SFX: 'SFX', 'SFX-L': 'SFX-L' }

/** CPU-architektúra → lapkakészletek, amelyeken BIOS-frissítés kellhet */
const BIOS_RULES = [
  { socket: 'AM5', arch: ['Zen 5'], chipsets: ['A620', 'B650', 'B650E', 'X670', 'X670E'] },
  { socket: 'AM4', arch: ['Zen 3'], chipsets: ['A320', 'B350', 'X370', 'B450', 'X470', 'A520', 'B550', 'X570'] },
  { socket: 'AM4', arch: ['Zen 2'], chipsets: ['A320', 'B350', 'X370', 'B450', 'X470'] },
  { socket: 'LGA 1700', arch: ['Raptor Lake', 'Raptor Lake Refresh'], chipsets: ['H610', 'B660', 'H670', 'Z690'] },
  { socket: 'LGA 1200', arch: ['Rocket Lake'], chipsets: ['H470', 'Z490'] },
  { socket: 'LGA 1851', arch: ['Arrow Lake Refresh'], chipsets: ['H810', 'B860', 'Z890'] },
]

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
const arr = (v) => (Array.isArray(v) && v.length > 0 ? v : undefined)

/** A gyártó nevét levágja a terméknév elejéről ("Intel Core i5" → "Core i5"). */
function stripBrand(name, brand) {
  const n = String(name ?? '').trim()
  if (brand && n.toLowerCase().startsWith(brand.toLowerCase() + ' ')) return n.slice(brand.length + 1)
  // pl. "Western Digital" gyártó, de a név "WD ..." – ilyenkor marad
  return n
}

function base(j, category) {
  const m = j.metadata ?? {}
  const brand = m.manufacturer ?? 'Ismeretlen'
  return {
    id: j.opendb_id,
    category,
    brand,
    name: stripBrand(m.name, brand),
    // néha több cikkszám van egy mezőben, nagy szóközökkel elválasztva
    partNumber: arr(m.part_numbers)?.[0]?.split(/\s{2,}/)[0]?.trim() || undefined,
    releaseYear: num(m.releaseYear),
  }
}

/** undefined mezők eldobása, hogy kisebb legyen a JSON */
function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

// ---------------------------------------------------------------- átalakítók
// Mindegyik null-t ad vissza, ha a termék nem kell (régi platform, hiányos adat).

const convert = {
  cpu(j) {
    if (!SOCKETS.has(j.socket)) return null
    const s = j.specifications ?? {}
    const igpModel = s.integratedGraphics?.model
    const arch = j.microarchitecture
    const bios = BIOS_RULES.find((r) => r.socket === j.socket && r.arch.includes(arch))
    return {
      ...base(j, 'cpu'),
      socket: j.socket,
      cores: j.cores?.total,
      threads: j.cores?.threads,
      tdpW: num(s.tdp),
      peakW: num(s.ppt),
      integratedGraphics: igpModel === undefined ? undefined : igpModel !== 'None',
      memoryTypes: arr(s.memory?.types?.filter((t) => t === 'DDR4' || t === 'DDR5')),
      microarchitecture: arch,
      biosUpdateChipsets: bios?.chipsets,
    }
  },

  motherboard(j) {
    if (!SOCKETS.has(j.socket)) return null
    const ff = BOARD_FF[j.form_factor]
    const memType = j.memory?.ram_type
    if (!ff || (memType !== 'DDR4' && memType !== 'DDR5')) return null
    const m2 = arr(j.m2_slots)
    const sd = j.storage_devices ?? {}
    const sata = (sd.sata_6_gb_s ?? 0) + (sd.sata_3_gb_s ?? 0)
    return {
      ...base(j, 'motherboard'),
      socket: j.socket,
      chipset: String(j.chipset ?? '').replace(/^(AMD|Intel)\s+/i, '') || undefined,
      formFactor: ff,
      memoryType: memType,
      memorySlots: num(j.memory?.slots),
      maxMemoryGb: num(j.memory?.max),
      // E-kulcsos hely a WiFi-kártyáé, az nem SSD-hely
      m2Slots: m2 ? m2.filter((s) => s.key !== 'E' && s.key !== 'B').length : undefined,
      sataPorts: j.storage_devices ? sata : undefined,
    }
  },

  memory(j) {
    if (j.ram_type !== 'DDR4' && j.ram_type !== 'DDR5') return null
    if (/SO-DIMM/i.test(j.form_factor ?? '')) return null
    if (j.registered === 'Registered') return null
    const modules = num(j.modules?.quantity)
    const size = num(j.modules?.capacity_gb)
    if (!modules || !size) return null
    return {
      ...base(j, 'memory'),
      memoryType: j.ram_type,
      modules,
      moduleSizeGb: size,
      speedMts: num(j.speed),
      casLatency: num(j.cas_latency),
    }
  },

  gpu(j) {
    if (['DDR2', 'DDR3', 'DDR4', 'GDDR2', 'GDDR3'].includes(j.memory_type)) return null
    const pc = j.power_connectors ?? {}
    const n12 = (pc.pcie_12V_2x6 ?? 0) + (pc.pcie_12VHPWR ?? 0)
    // 6 tűs igényt is a táp 6+2 tűs kábele szolgálja ki
    const n8 = (pc.pcie_8_pin ?? 0) + (pc.pcie_6_pin ?? 0)
    return {
      ...base(j, 'gpu'),
      chip: j.chipset ?? undefined,
      vramGb: num(j.memory),
      lengthMm: num(j.length),
      tdpW: num(j.tdp),
      // Ha egy 75 W feletti kártyánál minden csatlakozó 0, az hiányzó adat, nem "nem kell táp".
      powerConnectors:
        !j.power_connectors || (n12 + n8 === 0 && (num(j.tdp) ?? 0) > 75)
          ? undefined
          : clean({ '12V-2x6': n12 || undefined, '8pin': n8 || undefined }),
    }
  },

  storage(j) {
    const cap = num(j.capacity)
    if (!cap || cap < 240) return null
    const ff = String(j.form_factor ?? '')
    const iface = String(j.interface ?? '')
    let type
    if (ff.startsWith('M.2')) type = /SATA/i.test(iface) ? 'M.2 SATA' : 'M.2 NVMe'
    else if (ff === 'PCIe') type = 'PCIe'
    else if ((ff === '2.5"' || ff === '3.5"') && /SATA/i.test(iface)) type = 'SATA'
    else return null
    return {
      ...base(j, 'storage'),
      interface: type,
      capacityGb: cap,
      kind: j.storage_type === 'SSD' ? 'SSD' : 'HDD',
      formFactor: ff,
    }
  },

  psu(j) {
    const ff = PSU_FF[j.form_factor]
    const w = num(j.wattage)
    if (!ff || !w || w < 300) return null
    const c = j.connectors ?? {}
    return {
      ...base(j, 'psu'),
      wattage: w,
      formFactor: ff,
      efficiency: j.efficiency_rating ?? undefined,
      modular: j.modular ?? undefined,
      lengthMm: num(j.length),
      // Minden ATX/SFX tápon van PCIe kábel – ha mindkettő 0, az hiányzó adat.
      connectors:
        (c.pcie_12vhpwr ?? 0) + (c.pcie_6_plus_2_pin ?? 0) === 0
          ? undefined
          : clean({ '12V-2x6': c.pcie_12vhpwr || undefined, '8pin': c.pcie_6_plus_2_pin || undefined }),
    }
  },

  case(j) {
    const boards = (j.supported_motherboard_form_factors ?? []).map((f) => BOARD_FF[f]).filter(Boolean)
    if (boards.length === 0) return null
    let psu = [...new Set((j.supported_power_supply_form_factors ?? []).map((f) => PSU_FF[f]).filter(Boolean))]
    let psuInferred
    // Az OpenDB-ben a házak többségénél üres ez a mező. ATX lapot fogadó házba
    // szabványos ATX táp kerül – ezt feltételezzük, de jelöljük.
    if (psu.length === 0 && (boards.includes('ATX') || boards.includes('E-ATX'))) {
      psu = ['ATX', 'SFX', 'SFX-L']
      psuInferred = true
    }
    return {
      ...base(j, 'case'),
      caseType: j.form_factor ?? undefined,
      supportedBoards: boards,
      maxGpuLengthMm: num(j.max_video_card_length),
      maxCoolerHeightMm: num(j.max_cpu_cooler_height),
      maxPsuLengthMm: num(j.max_psu_length),
      psuFormFactors: psu.length ? psu : undefined,
      psuFormFactorsInferred: psuInferred,
      // radiátortámogatás: az OpenDB-ben nincs ilyen mező
    }
  },

  cooler(j) {
    const sockets = (j.cpu_sockets ?? []).filter((s) => SOCKETS.has(s))
    if (sockets.length === 0) return null
    const aio = j.water_cooled === true
    return {
      ...base(j, 'cooler'),
      type: aio ? 'aio' : 'air',
      sockets,
      heightMm: aio ? undefined : num(j.height),
      radiatorMm: aio ? num(j.radiator_size) : undefined,
      fanSizeMm: num(j.fan_size),
    }
  },
}

const SOURCE_DIRS = {
  cpu: 'CPU',
  motherboard: 'Motherboard',
  memory: 'RAM',
  gpu: 'GPU',
  storage: 'Storage',
  psu: 'PSU',
  case: 'PCCase',
  cooler: 'CPUCooler',
}

// ---------------------------------------------------------------- futtatás

let commit
try {
  commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  commit = 'ismeretlen'
}

const counts = {}
for (const [cat, dir] of Object.entries(SOURCE_DIRS)) {
  const files = fs.readdirSync(path.join(dbDir, dir)).filter((f) => f.endsWith('.json'))
  const out = []
  let skipped = 0
  for (const f of files) {
    let j
    try {
      j = JSON.parse(fs.readFileSync(path.join(dbDir, dir, f), 'utf8'))
    } catch {
      skipped++
      continue
    }
    const part = convert[cat](j)
    if (!part || !part.id || !part.name) {
      skipped++
      continue
    }
    out.push(clean(part))
  }
  out.sort((a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`))
  fs.writeFileSync(path.join(outDir, `${cat}.json`), JSON.stringify(out))
  counts[cat] = out.length
  console.log(`${cat.padEnd(12)} ${String(out.length).padStart(5)} db  (${skipped} kihagyva)`)
}

const meta = {
  source: 'BuildCores OpenDB',
  sourceUrl: 'https://github.com/buildcores/buildcores-open-db',
  license: 'CC BY-NC-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  commit,
  importedAt: new Date().toISOString(),
  counts,
}
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
console.log(`\nForrás: ${commit}`)
