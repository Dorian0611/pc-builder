// Füstteszt az importált OpenDB-adatokra (public/data). Ha még nem futott az
// importáló, kihagyja magát.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATEGORIES, createCatalog } from './catalog'
import { checkBuild } from './compat'
import type { CatalogData, Part } from './types'

const dir = path.resolve('public/data')
const available = fs.existsSync(path.join(dir, 'meta.json'))

describe.skipIf(!available)('importált OpenDB-adatok', () => {
  const data = Object.fromEntries(
    CATEGORIES.map((c) => [c.id, JSON.parse(fs.readFileSync(path.join(dir, `${c.id}.json`), 'utf8'))]),
  ) as CatalogData
  const catalog = createCatalog(data)
  const find = (cat: keyof CatalogData, text: string) =>
    (data[cat] as Part[]).find((p) => `${p.brand} ${p.name}`.includes(text))!

  it('minden kategóriában több száz termék, egyedi azonosítóval', () => {
    const ids = new Set<string>()
    for (const c of CATEGORIES) {
      expect(data[c.id].length).toBeGreaterThan(300)
      for (const p of data[c.id]) {
        expect(p.category).toBe(c.id)
        expect(p.name).toBeTruthy()
        ids.add(p.id)
      }
    }
    expect(ids.size).toBe(Object.values(data).reduce((s, l) => s + l.length, 0))
  })

  it('valódi összeállítás: Ryzen 7 9700X + B650 → BIOS figyelmeztetés, foglalat rendben', () => {
    const cpu = find('cpu', 'Ryzen 7 9700X')
    const mb = find('motherboard', 'B650 GAMING PLUS WIFI')
    const r = checkBuild(catalog.resolveBuild({ cpu: [cpu.id], motherboard: [mb.id] }))
    expect(r.find((c) => c.rule === 'cpu-socket')?.level).toBe('ok')
    expect(r.find((c) => c.rule === 'bios')?.level).toBe('warning')
  })

  it('valódi összeállítás: Intel CPU + AM5 lap → piros', () => {
    const cpu = find('cpu', 'Core i5 14400F')
    const mb = find('motherboard', 'B650 GAMING PLUS WIFI')
    const r = checkBuild(catalog.resolveBuild({ cpu: [cpu.id], motherboard: [mb.id] }))
    expect(r.find((c) => c.rule === 'cpu-socket')?.level).toBe('error')
  })
})
