import { describe, expect, it } from 'vitest'
import { addEstimates, comparableKey, effectivePrice } from './estimates'
import type { CatalogData, Gpu, Part, PriceBlock, Storage } from './types'

const price = (medianHuf: number): PriceBlock => ({
  medianHuf, minHuf: medianHuf, offerCount: 1, updatedAt: '2026-11-24', sources: ['pcx'],
})
const gpu = (id: string, chip: string, p?: number): Gpu => ({
  id, category: 'gpu', brand: 'X', name: id, chip, vramGb: 16, ...(p ? { price: price(p) } : {}),
})
const ssd = (id: string, capacityGb: number, p?: number): Storage => ({
  id, category: 'storage', brand: 'X', name: id, interface: 'M.2 NVMe', capacityGb, kind: 'SSD', ...(p ? { price: price(p) } : {}),
})
const data = (parts: Part[]) =>
  ({
    cpu: [], motherboard: [], memory: [], case: [], cooler: [], psu: [],
    gpu: parts.filter((p) => p.category === 'gpu'),
    storage: parts.filter((p) => p.category === 'storage'),
  }) as unknown as CatalogData

describe('addEstimates', () => {
  it('estimates from comparable priced parts, with a quartile range', () => {
    const d = data([
      gpu('a', 'RTX 5070 Ti', 380_000),
      gpu('b', 'RTX 5070 Ti', 390_000),
      gpu('c', 'RTX 5070 Ti', 420_000),
      gpu('target', 'RTX 5070 Ti'),
      gpu('other', 'RTX 5060'),
    ])
    expect(addEstimates(d)).toEqual({ estimated: 1 })
    const t = d.gpu.find((p) => p.id === 'target')!
    expect(t.estimate).toEqual({ medianHuf: 390_000, lowHuf: 385_000, highHuf: 405_000, count: 3 })
    expect(d.gpu.find((p) => p.id === 'other')!.estimate).toBeUndefined()
  })

  it('needs enough comparable prices', () => {
    const d = data([ssd('a', 1000, 30_000), ssd('b', 1000, 32_000), ssd('t', 1000)])
    addEstimates(d)
    expect(d.storage.find((p) => p.id === 't')!.estimate).toBeUndefined() // storage needs 3
  })

  it('never overrides a real price, and the real price wins in totals', () => {
    const d = data([gpu('a', 'RTX 5060', 120_000), gpu('b', 'RTX 5060', 130_000), gpu('c', 'RTX 5060', 999_000)])
    addEstimates(d)
    expect(d.gpu.every((p) => p.estimate === undefined)).toBe(true)
    expect(effectivePrice(d.gpu[2])).toBe(999_000)
  })
})

describe('comparableKey', () => {
  it('treats 960 GB and 1 TB drives alike, and tray/boxed CPUs alike', () => {
    expect(comparableKey(ssd('a', 960))).toBe(comparableKey(ssd('b', 1000)))
    const cpu = (name: string) => ({ id: name, category: 'cpu', brand: 'AMD', name, socket: 'AM5' }) as Part
    expect(comparableKey(cpu('Ryzen 7 7800X3D OEM/Tray'))).toBe(comparableKey(cpu('Ryzen 7 7800X3D')))
  })
})
