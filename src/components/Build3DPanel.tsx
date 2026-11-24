import { Component, lazy, Suspense, type ReactNode } from 'react'
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

export function Build3DPanel(props: Props) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <h2 className="text-sm font-semibold">3D nézet</h2>
        <span className="text-xs text-slate-400">forgatás: húzd · nagyítás: görgő</span>
      </div>
      <div className="h-72">
        <WebGLBoundary>
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-400">3D nézet betöltése…</div>}>
            <Build3D {...props} />
          </Suspense>
        </WebGLBoundary>
      </div>
      <p className="border-t border-slate-100 px-4 py-1.5 text-[11px] text-slate-400">
        Sematikus ábra a valódi méretekből (GPU-hossz, hűtőmagasság, alaplapméret); a piros alkatrész nem illik.
      </p>
    </section>
  )
}
