import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Catalog, CategoryInfo } from '../lib/catalog'
import { candidateErrors } from '../lib/builder'
import { PriceInfo } from './PriceInfo'
import { fullName, specLine } from '../lib/specs'
import type { BuildSelection, Part } from '../lib/types'

type Sort = 'newest' | 'name' | 'price-asc' | 'price-desc'
const PAGE = 100

interface Props {
  catalog: Catalog
  category: CategoryInfo
  selection: BuildSelection
  onPick: (p: Part) => void
  onClose: () => void
}

export function PartPicker({ catalog, category, selection, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [onlyCompatible, setOnlyCompatible] = useState(true)
  const [onlyPriced, setOnlyPriced] = useState(false)
  const [sort, setSort] = useState<Sort>('newest')
  const [limit, setLimit] = useState(PAGE)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => setLimit(PAGE), [deferredQuery, brand, onlyCompatible, onlyPriced, sort])

  const parts: Part[] = catalog.data[category.id]
  const brands = useMemo(() => [...new Set(parts.map((p) => p.brand))].sort((a, b) => a.localeCompare(b, 'hu')), [parts])

  // a kompatibilitás csak a választástól függ, a keresőszótól nem
  const withErrors = useMemo(
    () => parts.map((part) => ({ part, errors: candidateErrors(catalog, selection, part) })),
    [catalog, parts, selection],
  )

  const rows = useMemo(() => {
    const words = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = withErrors
      .filter(({ part }) => !brand || part.brand === brand)
      .filter(({ errors }) => !onlyCompatible || errors.length === 0)
      .filter(({ part }) => !onlyPriced || !!part.price)
      .filter(({ part }) => {
        if (!words.length) return true
        const hay = `${fullName(part)} ${specLine(part)} ${part.partNumber ?? ''}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    const price = (p: Part) => p.price?.medianHuf
    const byName = (a: Part, b: Part) => fullName(a).localeCompare(fullName(b), 'hu')
    list.sort((x, y) => {
      const a = x.part
      const b = y.part
      if (sort === 'name') return byName(a, b)
      if (sort === 'newest') return (b.releaseYear ?? 0) - (a.releaseYear ?? 0) || byName(a, b)
      const pa = price(a)
      const pb = price(b)
      if (pa === undefined && pb === undefined) return byName(a, b)
      if (pa === undefined) return 1
      if (pb === undefined) return -1
      return sort === 'price-asc' ? pa - pb : pb - pa
    })
    return list
  }, [withErrors, deferredQuery, brand, onlyCompatible, onlyPriced, sort])

  const incompatible = withErrors.filter((r) => r.errors.length > 0).length
  const pricedCount = useMemo(
    () => withErrors.filter((r) => r.part.price && (!onlyCompatible || r.errors.length === 0)).length,
    [withErrors, onlyCompatible],
  )

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-slate-900/40 p-2 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`${category.label} kiválasztása`}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold">
            {category.label} kiválasztása
            <span className="ml-2 text-sm font-normal text-slate-500">{rows.length.toLocaleString('hu-HU')} találat</span>
          </h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Bezárás">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3 text-sm">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Keresés: név, cikkszám, jellemző…"
            className="min-w-48 flex-1 rounded-md border border-slate-300 px-3 py-1.5"
          />
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="max-w-44 rounded-md border border-slate-300 px-2 py-1.5">
            <option value="">Minden gyártó</option>
            {brands.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-md border border-slate-300 px-2 py-1.5">
            <option value="newest">Legújabb elöl</option>
            <option value="name">Név szerint</option>
            <option value="price-asc">Ár szerint ↑</option>
            <option value="price-desc">Ár szerint ↓</option>
          </select>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onlyCompatible} onChange={(e) => setOnlyCompatible(e.target.checked)} />
            Csak kompatibilis
          </label>
          <label className="flex items-center gap-1.5" title="Csak azok a termékek, amelyeknek van ára (jelenleg: PCX)">
            <input
              type="checkbox"
              checked={onlyPriced}
              onChange={(e) => {
                setOnlyPriced(e.target.checked)
                // with prices on every row, cheapest-first is the useful order
                if (e.target.checked && sort === 'newest') setSort('price-asc')
              }}
            />
            Csak árral ({pricedCount.toLocaleString('hu-HU')})
          </label>
        </div>

        <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
          {rows.slice(0, limit).map(({ part, errors }) => (
            <li key={part.id} className="flex items-center gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{fullName(part)}</div>
                <div className="text-sm text-slate-500">
                  {specLine(part)}
                  {part.releaseYear ? ` · ${part.releaseYear}` : ''}
                </div>
                {errors.length > 0 && (
                  <div className="mt-1 text-sm text-red-700">⛔ {errors.map((e) => e.message).join(' ')}</div>
                )}
              </div>
              <div className="shrink-0">
                <PriceInfo part={part} compact />
              </div>
              <button
                onClick={() => onPick(part)}
                className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                {category.multi ? 'Hozzáad' : 'Kiválaszt'}
              </button>
            </li>
          ))}
          {rows.length > limit && (
            <li className="px-5 py-3 text-center">
              <button className="text-sm text-blue-700 hover:underline" onClick={() => setLimit((l) => l + PAGE)}>
                További {Math.min(PAGE, rows.length - limit)} mutatása ({(rows.length - limit).toLocaleString('hu-HU')} még)
              </button>
            </li>
          )}
          {rows.length === 0 && <li className="px-5 py-8 text-center text-slate-500">Nincs találat.</li>}
        </ul>

        {onlyCompatible && incompatible > 0 && (
          <div className="border-t border-slate-200 px-5 py-2 text-sm text-slate-500">
            {incompatible.toLocaleString('hu-HU')} nem kompatibilis termék elrejtve.{' '}
            <button className="text-blue-600 underline" onClick={() => setOnlyCompatible(false)}>
              Mutasd ezeket is
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
