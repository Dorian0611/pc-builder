import { SOURCE_LABELS } from '../lib/catalog'
import { formatHuf } from '../lib/builder'
import type { PriceBlock } from '../lib/types'

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric' }).format(new Date(`${iso}T12:00:00`))

/** Median price with shop count, date, source links and a warning for suspicious jumps. */
export function PriceInfo({ price, compact = false }: { price?: PriceBlock; compact?: boolean }) {
  if (!price) return <div className="text-sm text-slate-400">nincs ár</div>
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
        {price.offerCount} bolt · min. {formatHuf(price.minHuf)}
        {!compact && <> · {formatDate(price.updatedAt)}</>}
      </div>
      {!compact && price.links && price.links.length > 0 && (
        <div className="text-xs">
          {price.links.map((l) => (
            <a key={l.source} href={l.url} target="_blank" rel="noreferrer" className="ml-2 text-blue-700 hover:underline">
              {SOURCE_LABELS[l.source] ?? l.source} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
