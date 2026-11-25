import { useEffect, useRef, useState } from 'react'
import { decodeBuild, loadSavedBuilds, shareUrl, storeSavedBuilds, withSavedBuild, type SavedBuild } from '../lib/share'
import type { Catalog } from '../lib/catalog'
import type { BuildSelection } from '../lib/types'

interface Props {
  catalog: Catalog
  selection: BuildSelection
  hasAny: boolean
  onLoad: (sel: BuildSelection, missing: number) => void
  onNew: () => void
}

const btn = 'rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100'

/** Megosztás linkkel, mentés névvel a böngészőbe, mentett összeállítások listája. */
export function BuildActions({ catalog, selection, hasAny, onLoad, onNew }: Props) {
  const [saved, setSaved] = useState<SavedBuild[]>(loadSavedBuilds)
  const [open, setOpen] = useState<null | 'share' | 'save' | 'list'>(null)
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState('')
  const link = shareUrl(selection, window.location.href)

  useEffect(() => storeSavedBuilds(saved), [saved])
  useEffect(() => setCopied(false), [link])

  // kattintás a dobozon kívül vagy Esc: bezárás
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function share() {
    setOpen(open === 'share' ? null : 'share')
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false) // a doboz ettől még megjelenik, onnan kimásolható
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaved((list) => withSavedBuild(list, name, selection))
    setName('')
    setOpen('list')
  }

  return (
    <div ref={rootRef} className="relative flex flex-wrap gap-2">
      {hasAny && (
        <>
          <button onClick={share} className={btn}>Megosztás</button>
          <button onClick={() => setOpen(open === 'save' ? null : 'save')} className={btn}>Mentés</button>
        </>
      )}
      {saved.length > 0 && (
        <button onClick={() => setOpen(open === 'list' ? null : 'list')} className={btn}>
          Mentettek ({saved.length})
        </button>
      )}
      {hasAny && <button onClick={onNew} className={btn}>Új összeállítás</button>}

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-lg">
          {open === 'share' && (
            <>
              <div className="mb-2 font-medium">{copied ? 'Link kimásolva ✓' : 'Másold ki a linket:'}</div>
              <input
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
              />
              <p className="mt-2 text-xs text-slate-500">
                Aki megnyitja, ugyanezt az összeállítást látja. A link nem jár le, és nem kell hozzá fiók.
              </p>
            </>
          )}

          {open === 'save' && (
            <form onSubmit={save}>
              <label className="mb-2 block font-medium" htmlFor="build-name">Összeállítás neve</label>
              <div className="flex gap-2">
                <input
                  id="build-name"
                  autoFocus
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="pl. Gamer gép 2026"
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
                />
                <button type="submit" disabled={!name.trim()} className="rounded bg-blue-600 px-3 py-1 font-medium text-white disabled:opacity-40">
                  Mentés
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Ebben a böngészőben marad. Azonos névvel felülírja a régit.</p>
            </form>
          )}

          {open === 'list' && (
            <>
              <div className="mb-2 font-medium">Mentett összeállítások</div>
              {saved.length === 0 && <p className="text-slate-500">Még nincs mentett összeállítás.</p>}
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {saved.map((b) => (
                  <li key={b.name} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        const { selection: sel, missing } = decodeBuild(b.code, catalog.getPart)
                        onLoad(sel, missing)
                        setOpen(null)
                      }}
                    >
                      <div className="truncate font-medium text-blue-700">{b.name}</div>
                      <div className="text-xs text-slate-500">{new Date(b.savedAt).toLocaleString('hu-HU')}</div>
                    </button>
                    <button
                      onClick={() => setSaved((list) => list.filter((x) => x.name !== b.name))}
                      className="rounded px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                      aria-label={`${b.name} törlése`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
