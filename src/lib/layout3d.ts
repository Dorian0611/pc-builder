// Pure 3D layout of a build: turns the selected parts (and their real dimensions)
// into positioned part models. No three.js here, so it can be unit tested.
//
// Units: millimetres. Axes: x = towards the glass side panel, y = up, z = towards the front.
// The motherboard sits on the back wall (x = -W/2), its top-rear corner near the case's top-rear.

import type { BoardFormFactor, CheckLevel, Part, ResolvedBuild } from './types'

export type Vec3 = [number, number, number]

export type ItemKind =
  | 'board'
  | 'cpu'
  | 'ram'
  | 'air-cooler'
  | 'aio-pump'
  | 'aio-radiator'
  | 'gpu'
  | 'psu'
  | 'm2'
  | 'ssd'
  | 'hdd'

export interface BoardDetails {
  formFactor: BoardFormFactor
  /** offsets from the board centre, [y, z] */
  socket: [number, number]
  dimms: { y: number; z: number; length: number }[]
  pcie: { y: number; z: number; length: number }[]
}

export interface Item {
  key: string
  /** part this model belongs to (hover label, compatibility colour) */
  partId?: string
  kind: ItemKind
  /** centre of the bounding box */
  pos: Vec3
  /** bounding box size [x, y, z] */
  size: Vec3
  /** entry animation: offset it slides in from */
  from: Vec3
  /** the part fails a compatibility check → drawn red */
  error?: boolean
  board?: BoardDetails
  /** GPU: number of fans; radiator: fan diameter */
  fans?: number
  fanSize?: number
  /** radiator: pump centre (for the tubes), relative to the radiator centre */
  pumpOffset?: Vec3
  /** PSU / SFX etc. */
  sfx?: boolean
}

export interface Layout {
  /** case interior W × H × D (also frames the camera when there is no case) */
  box: Vec3
  hasCase: boolean
  items: Item[]
}

const BOARD_SIZE: Record<BoardFormFactor, [number, number]> = {
  // [height along y, depth along z]
  'E-ATX': [305, 277],
  ATX: [305, 244],
  mATX: [244, 244],
  ITX: [170, 170],
}

/** Case interior size from what boards it takes, stretched so its own GPU/cooler limits fit. */
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
  const items: Item[] = []
  const err = (p?: Part) => !!p && levels.get(p.id) === 'error'

  // ---- motherboard frame of reference
  const ff: BoardFormFactor = b.motherboard?.formFactor ?? (b.case?.supportedBoards.includes('ATX') ? 'ATX' : b.case?.supportedBoards[0] ?? 'ATX')
  const [bh, bd] = BOARD_SIZE[ff]
  const small = ff === 'ITX'
  const boardX = -W / 2 + 12 // board plane
  const face = boardX + 1 // component side of the board
  const top = H - 25
  const rear = -D / 2 + 35
  const centre: Vec3 = [boardX, top - bh / 2, rear + bd / 2]
  const socketY = top - (small ? 55 : 75)
  const socketZ = rear + (small ? 70 : 95)

  const slots = b.motherboard?.memorySlots ?? (small ? 2 : 4)
  const dimmZ = (i: number) => socketZ + 55 + i * 9
  const pcieCount = small ? 1 : ff === 'mATX' ? 2 : 3
  const firstSlotY = top - (small ? 145 : 175)

  if (b.motherboard)
    items.push({
      key: 'board',
      partId: b.motherboard.id,
      kind: 'board',
      pos: centre,
      size: [2, bh, bd],
      from: [-120, 0, 0],
      error: err(b.motherboard),
      board: {
        formFactor: ff,
        socket: [socketY - centre[1], socketZ - centre[2]],
        dimms: Array.from({ length: slots }, (_, i) => ({ y: socketY - 5 - centre[1], z: dimmZ(i) - centre[2], length: 140 })),
        pcie: Array.from({ length: pcieCount }, (_, i) => ({
          y: firstSlotY - i * 41 - centre[1],
          z: rear + 15 + (i === 0 ? 89 : 60) / 2 + 20 - centre[2],
          length: i === 0 ? 89 : 60,
        })),
      },
    })

  if (b.cpu)
    items.push({ key: 'cpu', partId: b.cpu.id, kind: 'cpu', pos: [face + 3, socketY, socketZ], size: [5, 40, 40], from: [80, 0, 0], error: err(b.cpu) })

  // ---- RAM: one stick per module, capped by the board's slots
  const modules = b.memory.flatMap((m) => Array.from({ length: m.modules }, () => m))
  modules.slice(0, Math.max(slots, 1)).forEach((m, i) =>
    items.push({
      key: `ram-${i}`,
      partId: m.id,
      kind: 'ram',
      pos: [face + 8 + 18, socketY - 5, dimmZ(i)],
      size: [36, 133, 7],
      from: [70, 0, 0],
      error: err(m),
    }),
  )

  // ---- CPU cooler
  const c = b.cooler
  if (c?.type === 'air') {
    const h = c.heightMm ?? 150
    items.push({
      key: 'cooler',
      partId: c.id,
      kind: 'air-cooler',
      // tower + fan on its front side
      pos: [face + h / 2, socketY, socketZ + 12],
      size: [h, 125, 80],
      from: [110, 0, 0],
      error: err(c),
    })
  } else if (c?.type === 'aio') {
    const len = c.radiatorMm ?? 240
    const fanSize = len % 140 === 0 ? 140 : 120
    const pump: Vec3 = [face + 18, socketY, socketZ]
    items.push({ key: 'pump', partId: c.id, kind: 'aio-pump', pos: pump, size: [36, 62, 62], from: [80, 0, 0], error: err(c) })
    const rad: Vec3 = [face + 12 + fanSize / 2, H - 12 - 14, Math.min(0, D / 2 - 20 - len / 2)]
    items.push({
      key: 'radiator',
      partId: c.id,
      kind: 'aio-radiator',
      pos: rad,
      size: [fanSize, 27 + 25, len], // radiator + fans hanging below it
      from: [0, 120, 0],
      error: err(c),
      fanSize,
      pumpOffset: [pump[0] - rad[0], pump[1] - rad[1], pump[2] - rad[2]],
    })
  }

  // ---- GPU: horizontal, sticking out of the board, length towards the front
  const g = b.gpu
  if (g) {
    const len = g.lengthMm ?? 280
    const thick = (g.tdpW ?? 200) > 250 ? 60 : 42
    items.push({
      key: 'gpu',
      partId: g.id,
      kind: 'gpu',
      pos: [face + 64, firstSlotY - thick / 2, -D / 2 + 10 + len / 2],
      size: [128, thick, len],
      from: [150, 0, 0],
      error: err(g),
      fans: len >= 260 ? 3 : len >= 180 ? 2 : 1,
    })
  }

  // ---- PSU: bottom rear, fan facing down
  const p = b.psu
  if (p) {
    const sfx = p.formFactor !== 'ATX'
    const size: Vec3 = sfx ? [125, 63, p.lengthMm ?? 100] : [150, 86, p.lengthMm ?? 150]
    items.push({
      key: 'psu',
      partId: p.id,
      kind: 'psu',
      pos: [boardX + size[0] / 2 + 5, size[1] / 2 + 6, -D / 2 + 5 + size[2] / 2],
      size,
      from: [0, -90, 0],
      error: err(p),
      sfx,
    })
  }

  // ---- storage: M.2 on the board, SATA drives in the front bay
  let m2i = 0
  let satai = 0
  for (const [i, s] of b.storage.entries()) {
    if (s.interface.startsWith('M.2')) {
      // first slot between CPU and GPU, the others below the graphics card
      const ys = small ? [firstSlotY - 20, firstSlotY - 50] : [firstSlotY + 32, firstSlotY - 75, firstSlotY - 115, firstSlotY - 155]
      const y = ys[Math.min(m2i++, ys.length - 1)]
      items.push({ key: `storage-${i}`, partId: s.id, kind: 'm2', pos: [face + 2, y, socketZ + 5], size: [4, 22, 80], from: [60, 0, 0], error: err(s) })
    } else {
      const hdd = s.kind === 'HDD' && s.formFactor !== '2.5"'
      const size: Vec3 = hdd ? [102, 26, 147] : [70, 7, 100]
      items.push({
        key: `storage-${i}`,
        partId: s.id,
        kind: hdd ? 'hdd' : 'ssd',
        pos: [boardX + 20 + size[0] / 2 + 30, 14 + size[1] / 2 + satai++ * 32, D / 2 - 15 - size[2] / 2],
        size,
        from: [0, 0, 130],
        error: err(s),
      })
    }
  }

  return { box, hasCase: !!b.case, items }
}
