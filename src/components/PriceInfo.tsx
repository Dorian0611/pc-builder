import { SOURCE_LABELS } from '../lib/catalog'
import { formatHuf } from '../lib/builder'
import { arukeresoSearchUrl } from '../lib/links'
import type { Part } from '../lib/types'

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`))

const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s

/**
 * Price of a part (median of the shops we have, or a single shop's price),
 * plus a link to current prices on Árukereső — that link is always shown,
 * even when we have no price of our own.
 */
export function PriceInfo({ part, compact = false }: { part: Part; compact?: boolean }) {
  const price = part.price
  const compare = (
    <a
      href={arukeresoSearchUrl(part)}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-blue-700 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      Árak az Árukeresőn ↗
    </a>
  )

  const est = part.estimate
  if (!price && est)
    return (
      <div
        className="text-right"
        title={
          est.basis === 'foreign'
            ? `Becslés ugyanennek a terméknek ${est.count} külföldi bolti ára alapján: forintra váltva, magyar áfával, a magyar árszinthez igazítva. A legolcsóbb külföldi ajánlat kb. ${formatHuf(est.lowHuf)}.`
            : `Becslés ${est.count} hasonló, bolti áras termék alapján; a hasonló termékek fele ${formatHuf(est.lowHuf)} és ${formatHuf(est.highHuf)} közé esik.`
        }
      >
        <div className="font-semibold tabular-nums text-amber-800">kb. {formatHuf(est.medianHuf)}</div>
        <div className="text-xs text-amber-700">
          {est.basis === 'foreign' ? `becsült · külföldi árakból (${est.count} bolt)` : 'becsült · hasonló termékekből'}
          {!compact && est.basis === 'similar' && ` · ${formatHuf(est.lowHuf)}–${formatHuf(est.highHuf)}`}
        </div>
        {compare}
      </div>
    )

  if (!price)
    return (
      <div className="text-right">
        <div className="text-sm text-slate-400">nincs ár</div>
        {compare}
      </div>
    )

  const single = price.offerCount === 1
  return (
    <div className="text-right">
      <div className="font-semibold tabular-nums">
        {price.flag === 'jump' && (
          <span className="mr-1 text-amber-600" title="Az ár jelentősen változott az előző naphoz képest – ellenőrizd.">
            ⚠
          </span>
        )}
        {formatHuf(price.medianHuf)}
      </div>
      <div className="text-xs text-slate-500">
        {single
          ? `${price.sources.map(sourceLabel).join(', ')} ár`
          : `${price.offerCount} bolt · min. ${formatHuf(price.minHuf)}`}
        {!compact && <> · {formatDate(price.updatedAt)}</>}
      </div>
      <div className="space-x-2">
        {!compact &&
          price.links?.map((l) => (
            <a key={l.source} href={l.url} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline">
              {sourceLabel(l.source)} ↗
            </a>
          ))}
        {compare}
      </div>
    </div>
  )
}
