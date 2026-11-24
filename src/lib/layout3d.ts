// Pure 3D layout of a build: turns the selected parts (and their real dimensions)
// into simple shapes. No three.js here, so it can be unit tested.
//
// Units: millimetres. Axes: x = towards the glass side panel, y = up, z = towards the front.
// The motherboard sits on the back wall (x = -W/2), its top-rear corner near the case's top-rear.

import type { BoardFormFactor, CheckLevel, Part, ResolvedBuild } from './types'

export type Vec3 = [number, number, number]

export interface Shape {
  key: string
  /** part this shape belongs to (for hover label and compatibility colour) */
  partId?: string
  kind: 'box' | 'fan'
  /** centre */
  pos: Vec3
  /** box: [x, y, z] size; fan: [diameter, thickness, 0] */
  size: Vec3
  /** fan axis */
  axis?: 'x' | 'y' | 'z'
  color: string
  opacity?: number
  /** entry animation direction */
  from?: Vec3
}

export interface Layout {
  /** case inner box W × H × D, also used for the camera when there is no case */
  box: Vec3
  hasCase: boolean
  shapes: Shape[]
}

const BOARD_SIZE: Record<BoardFormFactor, [number, number]> = {
  // [height along y, depth along z]
  'E-ATX': [305, 277],
  ATX: [305, 244],
  mATX: [244, 244],
  ITX: [170, 170],
}

export const COLORS = {
  board: '#3f4a5a',
  cpu: '#d4d8de',
  ram: '#2563eb',
  gpu: '#4b5563',
  gpuFan: '#9ca3af',
  cooler: '#cbd5e1',
  fan: '#64748b',
  psu: '#525c6b',
  storage: '#94a3b8',
  m2: '#16a34a',
  error: '#dc2626',
}

/** Case interior size from what boards it takes, stretched so its own GPU limit fits. */
function caseBox(b: ResolvedBuild): Vec3 {
  const c = b.case
  const boards = c?.supportedBoards ?? ['ATX']
  let box: Vec3 = boards.includes('ATX') || boards.includes('E-ATX') ? [220, 470, 450] : boards.includes('mATX') ? [210, 400, 400] : [185, 300, 360]
  if (c?.maxGpuLengthMm) box = [box[0], box[1], Math.max(box[2], c.maxGpuLengthMm + 60)]
  if (c?.maxCoolerHeightMm) box = [Math.max(box[0], c.maxCoolerHeightMm + 30), box[1], box[2]]
  return box
}

export function layoutBuild(b: ResolvedBuild, levels: Map<string, CheckLevel> = new Map()): Layout {
  const box = caseBox(b)
  const [W, H, D] = box
  const shapes: Shape[] = []
  const tint = (p: Part | undefined, color: string) => (p && levels.get(p.id) === 'error' ? COLORS.error : color)

  // ---- motherboard (also defines where CPU, RAM, GPU, M.2 go)
  const ff: BoardFormFactor = b.motherboard?.formFactor ?? (b.case?.supportedBoards.includes('ATX') ? 'ATX' : b.case?.supportedBoards[0] ?? 'ATX')
  const [bh, bd] = BOARD_SIZE[ff]
  const boardX = -W / 2 + 12
  const top = H - 25
  const rear = -D / 2 + 35
  /** point on the board surface, measured from its top-rear corner */
  const on = (fromTop: number, fromRear: number, out = 0): Vec3 => [boardX + 1 + out, top - fromTop, rear + fromRear]
  const small = ff === 'ITX'
  const socket = on(small ? 55 : 75, small ? 70 : 95)

  if (b.motherboard)
    shapes.push({
      key: 'board',
      partId: b.motherboard.id,
      kind: 'box',
      pos: [boardX, top - bh / 2, rear + bd / 2],
      size: [2, bh, bd],
      color: tint(b.motherboard, COLORS.board),
      from: [-120, 0, 0],
    })

  // ---- CPU
  if (b.cpu)
    shapes.push({
      key: 'cpu',
      partId: b.cpu.id,
      kind: 'box',
      pos: [socket[0] + 3, socket[1], socket[2]],
      size: [5, 40, 40],
      color: tint(b.cpu, COLORS.cpu),
      from: [80, 0, 0],
    })

  // ---- RAM: sticks in front of the socket, standing out from the board
  const slots = b.motherboard?.memorySlots ?? (small ? 2 : 4)
  const modules = b.memory.flatMap((m) => Array.from({ length: m.modules }, () => m))
  modules.slice(0, Math.max(slots, 1)).forEach((m, i) => {
    shapes.push({
      key: `ram-${i}`,
      partId: m.id,
      kind: 'box',
      pos: [boardX + 1 + 17, socket[1] - 5, socket[2] + 55 + i * 9],
      size: [32, 133, 7],
      color: tint(m, COLORS.ram),
      from: [60, 0, 0],
    })
  })

  // ---- CPU cooler
  const c = b.cooler
  if (c?.type === 'air') {
    const h = c.heightMm ?? 150
    shapes.push({
      key: 'cooler-fins',
      partId: c.id,
      kind: 'box',
      pos: [boardX + 1 + 10 + (h - 10) / 2, socket[1], socket[2]],
      size: [h - 10, 125, 55],
      color: tint(c, COLORS.cooler),
      from: [100, 0, 0],
    })
    shapes.push({
      key: 'cooler-fan',
      partId: c.id,
      kind: 'fan',
      pos: [boardX + 1 + 10 + (h - 10) / 2, socket[1], socket[2] + 27 + 13],
      size: [Math.min(120, h - 15), 25, 0],
      axis: 'z',
      color: COLORS.fan,
      from: [100, 0, 0],
    })
  } else if (c?.type === 'aio') {
    const len = c.radiatorMm ?? 240
    const fanD = len % 140 === 0 ? 140 : 120
    shapes.push({
      key: 'pump',
      partId: c.id,
      kind: 'box',
      pos: [socket[0] + 20, socket[1], socket[2]],
      size: [35, 60, 60],
      color: tint(c, COLORS.psu),
      from: [80, 0, 0],
    })
    const radY = H - 12 - 14
    shapes.push({
      key: 'radiator',
      partId: c.id,
      kind: 'box',
      pos: [boardX + 12 + 80, radY, 0],
      size: [fanD, 27, len],
      color: tint(c, COLORS.cooler),
      from: [0, 120, 0],
    })
    for (let i = 0; i < Math.round(len / fanD); i++)
      shapes.push({
        key: `radfan-${i}`,
        partId: c.id,
        kind: 'fan',
        pos: [boardX + 12 + 80, radY - 14 - 13, -len / 2 + fanD / 2 + i * fanD],
        size: [fanD - 4, 25, 0],
        axis: 'y',
        color: COLORS.fan,
        from: [0, 120, 0],
      })
  }

  // ---- GPU: horizontal, sticking out of the board, length towards the front
  const g = b.gpu
  if (g) {
    const len = g.lengthMm ?? 280
    const thick = (g.tdpW ?? 200) > 250 ? 60 : 42
    const slotY = top - (small ? 145 : 175)
    const x0 = boardX + 1
    const y = slotY - thick / 2
    const z = -D / 2 + 10 + len / 2
    shapes.push({
      key: 'gpu',
      partId: g.id,
      kind: 'box',
      pos: [x0 + 62, y, z],
      size: [124, thick, len],
      color: tint(g, COLORS.gpu),
      from: [140, 0, 0],
    })
    const fans = len >= 260 ? 3 : len >= 180 ? 2 : 1
    const fanD = Math.min(95, (len - 20) / fans - 6)
    for (let i = 0; i < fans; i++)
      shapes.push({
        key: `gpufan-${i}`,
        partId: g.id,
        kind: 'fan',
        pos: [x0 + 62, y - thick / 2 - 1, z - len / 2 + 10 + (i + 0.5) * ((len - 20) / fans)],
        size: [fanD, 3, 0],
        axis: 'y',
        color: COLORS.gpuFan,
        from: [140, 0, 0],
      })
  }

  // ---- PSU: bottom rear
  const p = b.psu
  if (p) {
    const sfx = p.formFactor !== 'ATX'
    const size: Vec3 = sfx ? [125, 63, p.lengthMm ?? 100] : [150, 86, p.lengthMm ?? 150]
    shapes.push({
      key: 'psu',
      partId: p.id,
      kind: 'box',
      pos: [boardX + size[0] / 2 + 5, size[1] / 2 + 2, -D / 2 + 5 + size[2] / 2],
      size,
      color: tint(p, COLORS.psu),
      from: [0, -80, 0],
    })
  }

  // ---- storage: M.2 on the board, SATA drives in the front bottom bay
  let m2i = 0
  let satai = 0
  for (const [i, s] of b.storage.entries()) {
    if (s.interface.startsWith('M.2')) {
      const at = on((small ? 120 : 150) + m2i++ * 45, small ? 80 : 110, 2)
      shapes.push({ key: `storage-${i}`, partId: s.id, kind: 'box', pos: at, size: [4, 22, 80], color: tint(s, COLORS.m2), from: [60, 0, 0] })
    } else {
      const hdd = s.kind === 'HDD' && s.formFactor !== '2.5"'
      const size: Vec3 = hdd ? [102, 26, 147] : [70, 7, 100]
      shapes.push({
        key: `storage-${i}`,
        partId: s.id,
        kind: 'box',
        pos: [boardX + 20 + size[0] / 2 + 30, 12 + size[1] / 2 + satai++ * 32, D / 2 - 15 - size[2] / 2],
        size,
        color: tint(s, COLORS.storage),
        from: [0, 0, 120],
      })
    }
  }

  return { box, hasCase: !!b.case, shapes }
}
