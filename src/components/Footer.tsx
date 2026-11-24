import type { CatalogMeta } from '../lib/types'

/** Forrásmegjelölés – a CC BY-NC-SA 4.0 licenc kötelező eleme. */
export function Footer({ meta }: { meta: CatalogMeta }) {
  return (
    <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500">
      Alkatrész-specifikációk:{' '}
      <a className="underline" href={meta.sourceUrl} target="_blank" rel="noreferrer">
        {meta.source}
      </a>{' '}
      (forrásverzió: <code>{meta.commit.slice(0, 7)}</code>), licenc:{' '}
      <a className="underline" href={meta.licenseUrl} target="_blank" rel="noreferrer">
        {meta.license}
      </a>
      . Módosítások: a mai asztali platformokra szűrt részhalmaz, mezőnevek és mértékegységek átalakítva, a tápméret egyes
      házaknál az alaplapméretből becsülve. Az átalakított adatok ugyanezen licenc alatt érhetők el.
    </footer>
  )
}
