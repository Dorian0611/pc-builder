import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { CheckLevel, Part, ResolvedBuild } from '../lib/types'

// three.js is ~250 kB gzipped: load it only when the panel is shown
const Build3D = lazy(() => import('./Build3D'))

class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="flex h-full items-center justify-center p-4 text-center text-sm text-slate-500">
        A 3D nézet ezen az eszközön nem érhető el.
      </div>
    ) : (
      this.props.children
    )
  }
}

interface Props {
  build: ResolvedBuild
  levels: Map<string, CheckLevel>
  parts: Part[]
}

function Scene(props: Props) {
  return (
    <WebGLBoundary>
      <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-400">3D nézet betöltése…</div>}>
        <Build3D {...props} />
      </Suspense>
    </WebGLBoundary>
  )
}

export function Build3DPanel(props: Props) {
  const [large, setLarge] = useState(false)

  useEffect(() => {
    if (!large) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLarge(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [large])

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <h2 className="text-sm font-semibold">3D nézet</h2>
        <button onClick={() => setLarge(true)} className="text-xs text-blue-700 hover:underline">
          Nagy nézet ⤢
        </button>
      </div>
      {/* the small view is not rendered while the large one is open (one WebGL context) */}
      <div className="h-80">{!large && <Scene {...props} />}</div>
      <p className="border-t border-slate-100 px-4 py-1.5 text-[11px] text-slate-400">
        Forgatás: húzd · nagyítás: görgő. Az ábra a valódi méretekből készül (GPU-hossz, hűtőmagasság, alaplapméret); a
        piros alkatrész nem illik.
      </p>

      {large && (
        <div className="fixed inset-0 z-30 flex flex-col bg-slate-900/70 p-2 sm:p-6" onClick={() => setLarge(false)}>
          <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="font-semibold">3D nézet</h2>
              <button onClick={() => setLarge(false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Bezárás">
                ✕
              </button>
            </div>
            <div className="flex-1">
              <Scene {...props} />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
