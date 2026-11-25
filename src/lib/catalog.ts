import { addEstimates } from './estimates'
import type {
  BuildSelection,
  CatalogData,
  CatalogMeta,
  Category,
  Part,
  PartByCategory,
  ForeignPrices,
  PriceBlock,
  ResolvedBuild,
} from './types'

export interface CategoryInfo {
  id: Category
  label: string
  /** több darab is választható (pl. több SSD) */
  multi: boolean
  /** kötelező egy működő géphez */
  required: boolean
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'cpu', label: 'Processzor', multi: false, required: true },
  { id: 'motherboard', label: 'Alaplap', multi: false, required: true },
  { id: 'memory', label: 'Memória', multi: true, required: true },
  { id: 'gpu', label: 'Videókártya', multi: false, required: false },
  { id: 'storage', label: 'SSD / HDD', multi: true, required: true },
  { id: 'psu', label: 'Tápegység', multi: false, required: true },
  { id: 'case', label: 'Ház', multi: false, required: true },
  { id: 'cooler', label: 'Processzorhűtő', multi: false, required: true },
]

export interface Catalog {
  data: CatalogData
  getPart(id: string): Part | undefined
  resolveBuild(sel: BuildSelection): ResolvedBuild
}

export function createCatalog(data: CatalogData): Catalog {
  const byId = new Map<string, Part>()
  for (const list of Object.values(data)) for (const p of list) byId.set(p.id, p)

  const pick = <C extends Category>(sel: BuildSelection, c: C): PartByCategory[C][] =>
    (sel[c] ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is PartByCategory[C] => p?.category === c)

  return {
    data,
    getPart: (id) => byId.get(id),
    resolveBuild: (sel) => ({
      cpu: pick(sel, 'cpu')[0],
      motherboard: pick(sel, 'motherboard')[0],
      memory: pick(sel, 'memory'),
      gpu: pick(sel, 'gpu')[0],
      storage: pick(sel, 'storage'),
      psu: pick(sel, 'psu')[0],
      case: pick(sel, 'case')[0],
      cooler: pick(sel, 'cooler')[0],
    }),
  }
}

/** A public/data alatti, importáló által generált JSON-ok betöltése. */
export async function loadCatalog(baseUrl = `${import.meta.env.BASE_URL}data/`): Promise<{
  catalog: Catalog
  meta: CatalogMeta
}> {
  const get = async (name: string) => {
    const r = await fetch(`${baseUrl}${name}.json`)
    if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`)
    return r.json()
  }
  const [meta, prices, ...lists] = await Promise.all([
    get('meta'),
    // prices are optional: the site works (without prices) if the file is missing
    get('prices').catch(() => ({})),
    // optional too: foreign shop prices, used only for estimates
    get('foreign-prices').catch(() => undefined),
    ...CATEGORIES.map((c) => get(c.id)),
  ])
  const foreign = lists.shift() as ForeignPrices | undefined
  const data = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, lists[i]])) as CatalogData
  attachPrices(data, prices)
  addEstimates(data, foreign)
  return { catalog: createCatalog(data), meta }
}

/** Copies the price blocks onto the parts (the price file is kept separate so the nightly job only touches it). */
export function attachPrices(data: CatalogData, prices: Record<string, PriceBlock>): void {
  for (const list of Object.values(data) as Part[][])
    for (const p of list) {
      const price = prices[p.id]
      if (price) p.price = price
    }
}

export const SOURCE_LABELS: Record<string, string> = {
  manual: 'kézi',
  arukereso: 'Árukereső',
  argep: 'Árgép',
  pcx: 'PCX',
  ipon: 'iPon',
  emag: 'eMAG',
}

/** Egy kategória egy elemének hozzáadása / cseréje a választáshoz. */
export function withPart(sel: BuildSelection, part: Part): BuildSelection {
  const info = CATEGORIES.find((c) => c.id === part.category)!
  const current = sel[part.category] ?? []
  return {
    ...sel,
    [part.category]: info.multi ? [...current, part.id] : [part.id],
  }
}

export function withoutPart(sel: BuildSelection, category: Category, index: number): BuildSelection {
  const current = [...(sel[category] ?? [])]
  current.splice(index, 1)
  return { ...sel, [category]: current }
}
