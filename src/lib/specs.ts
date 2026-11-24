import type { Part } from './types'

const join = (...xs: (string | number | false | undefined | null)[]) => xs.filter(Boolean).join(' · ')
const mm = (v?: number) => (v ? `${v} mm` : undefined)
const watt = (v?: number) => (v ? `${v} W` : undefined)

/** Rövid, egysoros műszaki összefoglaló a listákhoz. */
export function specLine(p: Part): string {
  switch (p.category) {
    case 'cpu':
      return join(
        p.socket,
        p.cores && `${p.cores} mag / ${p.threads ?? '?'} szál`,
        watt(p.tdpW),
        p.memoryTypes?.join('/'),
        p.integratedGraphics && 'IGP',
      )
    case 'motherboard':
      return join(
        p.socket,
        p.chipset,
        p.formFactor,
        `${p.memoryType}${p.memorySlots ? ` × ${p.memorySlots}` : ''}`,
        p.m2Slots !== undefined && `${p.m2Slots}× M.2`,
      )
    case 'memory':
      return join(`${p.memoryType}${p.speedMts ? `-${p.speedMts}` : ''}`, p.casLatency && `CL${p.casLatency}`, `${p.modules} × ${p.moduleSizeGb} GB`)
    case 'gpu':
      return join(p.chip, p.vramGb && `${p.vramGb} GB`, mm(p.lengthMm), watt(p.tdpW))
    case 'storage':
      return join(p.kind, p.interface, p.capacityGb >= 1000 ? `${+(p.capacityGb / 1000).toFixed(2)} TB` : `${p.capacityGb} GB`)
    case 'psu':
      return join(`${p.wattage} W`, p.formFactor, p.efficiency, p.modular && p.modular !== 'Non-Modular' && `${p.modular} moduláris`, p.connectors?.['12V-2x6'] && '12V-2x6')
    case 'case':
      return join(
        p.supportedBoards.join('/'),
        p.maxGpuLengthMm && `GPU ≤ ${p.maxGpuLengthMm} mm`,
        p.maxCoolerHeightMm && `hűtő ≤ ${p.maxCoolerHeightMm} mm`,
      )
    case 'cooler':
      return p.type === 'air'
        ? join('Léghűtő', mm(p.heightMm), p.sockets.join(', '))
        : join('Vízhűtő', p.radiatorMm && `${p.radiatorMm} mm radiátor`, p.sockets.join(', '))
  }
}

export const fullName = (p: Part) => `${p.brand} ${p.name}`
