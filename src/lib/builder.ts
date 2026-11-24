import { withPart, type Catalog } from './catalog'
import { checkBuild } from './compat'
import type { BuildSelection, CheckResult, Part, ResolvedBuild } from './types'

/**
 * Azok a piros hibák, amelyeket ez a jelölt okozna, ha hozzáadnánk az
 * összeállításhoz. Üres tömb = kompatibilis a már kiválasztott alkatrészekkel.
 */
export function candidateErrors(catalog: Catalog, sel: BuildSelection, part: Part): CheckResult[] {
  const next = catalog.resolveBuild(withPart(sel, part))
  return checkBuild(next).filter((c) => c.level === 'error' && c.partIds.includes(part.id))
}

export function buildParts(b: ResolvedBuild): Part[] {
  return [b.cpu, b.motherboard, ...b.memory, b.gpu, ...b.storage, b.psu, b.case, b.cooler].filter(
    (p): p is Part => !!p,
  )
}

export function totalPrice(b: ResolvedBuild): { totalHuf: number; priced: number; missingPrice: number } {
  let totalHuf = 0
  let priced = 0
  let missingPrice = 0
  for (const p of buildParts(b)) {
    if (p.price) {
      totalHuf += p.price.medianHuf
      priced++
    } else missingPrice++
  }
  return { totalHuf, priced, missingPrice }
}

export const formatHuf = (n: number) =>
  new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n)
