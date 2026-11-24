// Estimated prices for parts that have no shop price of their own, from the prices of
// comparable parts that do (same GPU chip, same CPU model, same SSD size and interface…).
// Always shown as an estimate with a range, never as a real price.

import type { CatalogData, Part, PriceEstimate } from './types'

/** Parts are "comparable" when they share this key; undefined = never estimated. */
export function comparableKey(p: Part): string | undefined {
  switch (p.category) {
    case 'gpu':
      return p.chip ? `${p.chip}|${p.vramGb ?? '?'}GB` : undefined
    case 'cpu':
      // "Ryzen 7 7800X3D OEM/Tray" and "Ryzen 7 7800X3D" are the same chip
      return `${p.brand}|${p.name.replace(/\b(OEM\/Tray|OEM|Tray|Boxed|BOX|MPK|WOF)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase()}`
    case 'memory': {
      const speed = p.speedMts ? Math.round(p.speedMts / 400) * 400 : '?'
      return `${p.memoryType}|${p.modules}x${p.moduleSizeGb}|${speed}`
    }
    case 'storage': {
      // 960 GB and 1 TB drives are priced alike
      const cap = Math.round(p.capacityGb / 250) * 250
      return `${p.kind}|${p.interface}|${cap}`
    }
    case 'psu':
      return `${Math.round(p.wattage / 50) * 50}|${p.efficiency ?? '?'}|${p.formFactor}`
    case 'motherboard':
      return p.chipset ? `${p.chipset}|${p.formFactor}|${p.memoryType}` : undefined
    case 'cooler':
      return p.type === 'aio'
        ? p.radiatorMm
          ? `aio|${p.radiatorMm}`
          : undefined
        : p.heightMm
          ? `air|${p.heightMm < 80 ? 'low' : p.heightMm < 145 ? 'mid' : 'tower'}|${p.fanSizeMm ?? '?'}`
          : undefined
    case 'case':
      return `${p.caseType ?? '?'}|${[...p.supportedBoards].sort().join('/')}`
  }
}

/** Fewer comparable prices than this → no estimate (too unreliable). */
const MIN_SAMPLES: Record<Part['category'], number> = {
  cpu: 1, // same chip: a single price is already a good guide
  gpu: 2,
  memory: 3,
  storage: 3,
  psu: 3,
  motherboard: 3,
  cooler: 4,
  case: 4,
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo))
}

/** Adds `estimate` to every unpriced part that has enough priced comparable parts. */
export function addEstimates(data: CatalogData): { estimated: number } {
  let estimated = 0
  for (const list of Object.values(data) as Part[][]) {
    const groups = new Map<string, number[]>()
    for (const p of list) {
      if (!p.price) continue
      const k = comparableKey(p)
      if (!k) continue
      const g = groups.get(k)
      if (g) g.push(p.price.medianHuf)
      else groups.set(k, [p.price.medianHuf])
    }
    for (const g of groups.values()) g.sort((a, b) => a - b)
    for (const p of list) {
      p.estimate = undefined
      if (p.price) continue
      const k = comparableKey(p)
      const g = k ? groups.get(k) : undefined
      if (!g || g.length < MIN_SAMPLES[p.category]) continue
      const est: PriceEstimate = {
        medianHuf: quantile(g, 0.5),
        lowHuf: quantile(g, 0.25),
        highHuf: quantile(g, 0.75),
        count: g.length,
      }
      p.estimate = est
      estimated++
    }
  }
  return { estimated }
}

/** The price to use in totals and sorting: a real price, else the estimate. */
export const effectivePrice = (p: Part): number | undefined => p.price?.medianHuf ?? p.estimate?.medianHuf
