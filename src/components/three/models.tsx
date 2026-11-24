// Procedural part models (no downloaded assets). Everything is in millimetres,
// centred on the item's bounding box; the scene scales mm → scene units once.
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Item, Vec3 } from '../../lib/layout3d'

// ---------------------------------------------------------------- materials

type Mat = { color: string; metalness?: number; roughness?: number; emissive?: string; emissiveIntensity?: number }
const M = {
  steel: { color: '#2e333b', metalness: 0.5, roughness: 0.45 },
  shroud: { color: '#3a3f48', metalness: 0.35, roughness: 0.45 },
  plastic: { color: '#1d2025', metalness: 0.05, roughness: 0.6 },
  pcb: { color: '#1e242b', metalness: 0.15, roughness: 0.7 },
  pcbGreen: { color: '#1f4d2c', metalness: 0.1, roughness: 0.7 },
  alu: { color: '#c3c8cf', metalness: 0.85, roughness: 0.32 },
  aluDark: { color: '#5b616b', metalness: 0.8, roughness: 0.38 },
  copper: { color: '#c27a48', metalness: 1, roughness: 0.28 },
  nickel: { color: '#b4bac2', metalness: 0.95, roughness: 0.22 },
  label: { color: '#e5e7eb', metalness: 0, roughness: 0.8 },
  slot: { color: '#30343b', metalness: 0.2, roughness: 0.6 },
  rubber: { color: '#0e0f11', metalness: 0, roughness: 0.85 },
  rgb: { color: '#1e3a8a', metalness: 0, roughness: 0.4, emissive: '#60a5fa', emissiveIntensity: 1.4 },
  error: { color: '#b91c1c', metalness: 0.3, roughness: 0.5, emissive: '#7f1d1d', emissiveIntensity: 0.4 },
} satisfies Record<string, Mat>

const Std = ({ m }: { m: Mat }) => <meshStandardMaterial {...m} />

function Box({ size, pos = [0, 0, 0], m, rot }: { size: Vec3; pos?: Vec3; m: Mat; rot?: Vec3 }) {
  return (
    <mesh position={pos} rotation={rot} castShadow receiveShadow>
      <boxGeometry args={size} />
      <Std m={m} />
    </mesh>
  )
}

function Cyl({ r, h, pos = [0, 0, 0], axis = 'y', m, seg = 32 }: { r: number; h: number; pos?: Vec3; axis?: 'x' | 'y' | 'z'; m: Mat; seg?: number }) {
  const rot: Vec3 = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]
  return (
    <mesh position={pos} rotation={rot} castShadow>
      <cylinderGeometry args={[r, r, h, seg]} />
      <Std m={m} />
    </mesh>
  )
}

/** Many identical thin boxes (cooler / radiator fins) in one draw call. */
function Stack({ size, count, step, axis, start, m }: { size: Vec3; count: number; step: number; axis: 0 | 1 | 2; start: Vec3; m: Mat }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mtx = new THREE.Matrix4()
    for (let i = 0; i < count; i++) {
      const p = [...start] as Vec3
      p[axis] += i * step
      mtx.makeTranslation(p[0], p[1], p[2])
      ref.current!.setMatrixAt(i, mtx)
    }
    ref.current!.instanceMatrix.needsUpdate = true
  }, [count, step, axis, start])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(count, 1)]} castShadow>
      <boxGeometry args={size} />
      <Std m={m} />
    </instancedMesh>
  )
}

// ---------------------------------------------------------------- fan

/** Square-framed fan with spinning blades. Built along +y, rotated onto `axis`. */
export function Fan({ size, depth = 25, pos = [0, 0, 0], axis = 'y', frame = M.plastic, blade = M.plastic, flip = false }: {
  size: number
  depth?: number
  pos?: Vec3
  axis?: 'x' | 'y' | 'z'
  frame?: Mat
  blade?: Mat
  flip?: boolean
}) {
  const blades = useRef<THREE.Group>(null)
  const r = size / 2 - 3
  const frameGeo = useMemo(() => {
    const s = new THREE.Shape()
    const h = size / 2
    s.moveTo(-h, -h).lineTo(h, -h).lineTo(h, h).lineTo(-h, h).lineTo(-h, -h)
    const hole = new THREE.Path()
    hole.absarc(0, 0, r + 1, 0, Math.PI * 2, true)
    s.holes.push(hole)
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 32 })
    g.translate(0, 0, -depth / 2)
    g.rotateX(Math.PI / 2)
    return g
  }, [size, depth, r])
  useFrame((_, dt) => {
    if (blades.current) blades.current.rotation.y += dt * 9 * (flip ? -1 : 1)
  })
  const rot: Vec3 = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]
  const n = 7
  return (
    <group position={pos} rotation={rot}>
      <mesh geometry={frameGeo} castShadow>
        <Std m={frame} />
      </mesh>
      <group ref={blades}>
        <Cyl r={r * 0.32} h={depth * 0.7} m={blade} />
        {Array.from({ length: n }, (_, i) => (
          <group key={i} rotation={[0, (i / n) * Math.PI * 2, 0]}>
            <mesh position={[r * 0.64, 0, 0]} rotation={[0.45, 0, 0]}>
              <boxGeometry args={[r * 0.68, depth * 0.5, r * 0.42]} />
              <Std m={blade} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

// ---------------------------------------------------------------- parts

function Board({ item }: { item: Item }) {
  const [, bh, bd] = item.size
  const d = item.board!
  const pcb = item.error ? M.error : M.pcb
  const [sy, sz] = d.socket
  const small = d.formFactor === 'ITX'
  const vrmTopLen = sz + bd / 2 + 10
  return (
    <group>
      <Box size={[2, bh, bd]} m={pcb} />
      {/* CPU socket */}
      <Box size={[3, 56, 56]} pos={[2.5, sy, sz]} m={M.slot} />
      {/* VRM heatsinks: above and behind the socket */}
      <Box size={[16, 22, vrmTopLen]} pos={[9, sy + 46, -bd / 2 + 10 + vrmTopLen / 2]} m={M.aluDark} />
      <Box size={[16, small ? 70 : 100, 20]} pos={[9, sy - (small ? 5 : 15), -bd / 2 + 24]} m={M.aluDark} />
      {/* rear I/O cover */}
      <Box size={[24, small ? 90 : 150, 30]} pos={[13, bh / 2 - (small ? 50 : 80), -bd / 2 + 15]} m={M.shroud} />
      {/* DIMM slots */}
      {d.dimms.map((s, i) => (
        <group key={`d${i}`}>
          <Box size={[7, s.length, 6]} pos={[4.5, s.y, s.z]} m={M.slot} />
          <Box size={[8, 6, 7]} pos={[5, s.y + s.length / 2 + 2, s.z]} m={M.label} />
        </group>
      ))}
      {/* PCIe slots, the first one reinforced */}
      {d.pcie.map((s, i) => (
        <Box key={`p${i}`} size={[9, 7, s.length]} pos={[5, s.y, s.z]} m={i === 0 ? M.nickel : M.slot} />
      ))}
      {/* chipset heatsink and 24-pin power */}
      {!small && <Box size={[9, 50, 50]} pos={[5.5, -bh / 2 + 65, bd / 2 - 60]} m={M.aluDark} />}
      <Box size={[12, 52, 10]} pos={[7, sy - 5, bd / 2 - 7]} m={M.plastic} />
    </group>
  )
}

function Cpu({ item }: { item: Item }) {
  return (
    <group>
      <Box size={[2, 40, 40]} pos={[-1.5, 0, 0]} m={M.pcbGreen} />
      <Box size={[3, 34, 34]} pos={[1, 0, 0]} m={item.error ? M.error : M.nickel} />
    </group>
  )
}

function Ram({ item }: { item: Item }) {
  const [x, y] = item.size
  const body = item.error ? M.error : M.shroud
  return (
    <group>
      <Box size={[x - 6, y, 1.2]} pos={[-3, 0, 0]} m={M.pcbGreen} />
      <Box size={[x - 4, y - 2, 2.2]} pos={[-2, 0, -1.8]} m={body} />
      <Box size={[x - 4, y - 2, 2.2]} pos={[-2, 0, 1.8]} m={body} />
      <Box size={[4, y - 6, 5.5]} pos={[x / 2 - 2, 0, 0]} m={M.rgb} />
    </group>
  )
}

function AirCooler({ item }: { item: Item }) {
  const [h, fy] = item.size
  const low = h < 80
  const finZ = -12 // fins sit behind the fan, which takes the front of the bounding box
  const finStart = -h / 2 + (low ? 10 : 28)
  const finEnd = h / 2 - (low ? 16 : 6)
  const pitch = 2.2
  const count = Math.max(1, Math.floor((finEnd - finStart) / pitch))
  const fins = item.error ? M.error : M.alu
  return (
    <group>
      {/* nickel base and copper heatpipes running out to the fin stack */}
      <Box size={[7, 42, 42]} pos={[-h / 2 + 3.5, 0, finZ + 12]} m={M.nickel} />
      {[-18, -6, 6, 18].map((z, i) => (
        <Cyl key={z} r={3} h={h - 10} axis="x" pos={[2, i % 2 ? 9 : -9, finZ + 12 + z]} m={M.copper} seg={12} />
      ))}
      <Stack size={[0.5, fy, 55]} count={count} step={pitch} axis={0} start={[finStart, 0, finZ]} m={fins} />
      {!low && <Box size={[3, fy + 2, 57]} pos={[h / 2 - 1.5, 0, finZ]} m={M.plastic} />}
      {low ? (
        <Fan size={Math.min(92, fy)} depth={14} axis="x" pos={[h / 2 - 7, 0, finZ]} />
      ) : (
        <Fan size={Math.min(120, fy)} depth={25} axis="z" pos={[finStart + (finEnd - finStart) / 2, 0, finZ + 27.5 + 12.5]} />
      )}
    </group>
  )
}

function AioPump({ item }: { item: Item }) {
  return (
    <group>
      <Cyl r={30} h={28} axis="x" pos={[-4, 0, 0]} m={item.error ? M.error : M.plastic} seg={48} />
      <Cyl r={27} h={6} axis="x" pos={[13, 0, 0]} m={M.shroud} seg={48} />
      <mesh position={[16.2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[24, 1.4, 8, 48]} />
        <Std m={M.rgb} />
      </mesh>
    </group>
  )
}

function Tube({ from, to, bulge }: { from: Vec3; to: Vec3; bulge: Vec3 }) {
  const geo = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(...bulge))
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 32, 5, 10, false)
  }, [from, to, bulge])
  return (
    <mesh geometry={geo} castShadow>
      <Std m={M.rubber} />
    </mesh>
  )
}

function AioRadiator({ item }: { item: Item }) {
  const [fx, , len] = item.size
  const fan = item.fanSize ?? 120
  const coreY = 12.5
  const n = Math.max(1, Math.round(len / fan))
  const core = item.error ? M.error : M.steel
  const p = item.pumpOffset ?? [0, -200, 0]
  return (
    <group>
      <Box size={[fx - 4, 27, len - 34]} pos={[0, coreY, 0]} m={core} />
      <Stack size={[fx - 10, 25, 0.35]} count={Math.floor((len - 40) / 2.5)} step={2.5} axis={2} start={[0, coreY, -len / 2 + 20]} m={M.aluDark} />
      <Box size={[fx, 32, 17]} pos={[0, coreY, -len / 2 + 8.5]} m={M.steel} />
      <Box size={[fx, 32, 17]} pos={[0, coreY, len / 2 - 8.5]} m={M.steel} />
      {Array.from({ length: n }, (_, i) => (
        <Fan key={i} size={fan - 2} depth={25} axis="y" pos={[0, coreY - 13.5 - 12.5, -len / 2 + 17 + fan / 2 + i * ((len - 34 - fan) / Math.max(1, n - 1) || 0)]} />
      ))}
      <Tube from={[-fx / 2 + 25, coreY - 10, -len / 2 + 8]} to={[p[0] + 18, p[1] + 14, p[2]]} bulge={[50, -10, 40]} />
      <Tube from={[-fx / 2 + 45, coreY - 10, -len / 2 + 8]} to={[p[0] + 18, p[1] - 14, p[2]]} bulge={[65, -30, 55]} />
    </group>
  )
}

function Gpu({ item }: { item: Item }) {
  const [x, t, len] = item.size
  const fans = item.fans ?? 2
  const shroud = item.error ? M.error : M.shroud
  const fanD = Math.min(96, (len - 30) / fans - 4, x - 18)
  return (
    <group>
      {/* backplate (top), PCB, cooler shroud (bottom) */}
      <Box size={[x - 8, 2, len - 4]} pos={[2, t / 2 - 1, 0]} m={M.aluDark} />
      <Box size={[x - 16, 1.6, len - 12]} pos={[-2, t / 2 - 3.5, -2]} m={M.pcb} />
      <Stack size={[x - 22, t - 14, 0.5]} count={Math.floor((len - 20) / 2.4)} step={2.4} axis={2} start={[2, -1, -len / 2 + 10]} m={M.aluDark} />
      <Box size={[x - 4, 6, len - 2]} pos={[2, -t / 2 + 3, 0]} m={shroud} />
      <Box size={[x - 4, t - 6, 3]} pos={[2, 0, len / 2 - 1.5]} m={shroud} />
      <Box size={[3, t - 6, len - 2]} pos={[x / 2 - 1.5, 0, 0]} m={shroud} />
      <Box size={[1, 6, len * 0.5]} pos={[x / 2 + 0.3, 2, 0]} m={M.rgb} />
      {Array.from({ length: fans }, (_, i) => (
        <Fan key={i} size={fanD} depth={11} axis="y" flip={i % 2 === 1} pos={[2, -t / 2 + 5, -len / 2 + 15 + (i + 0.5) * ((len - 30) / fans)]} />
      ))}
      {/* slot bracket with display outputs, power connector on the top edge */}
      <Box size={[x - 8, t + 4, 1.5]} pos={[-4, 0, -len / 2 - 1]} m={M.nickel} />
      {[-30, -10, 10, 30].map((dx) => (
        <Box key={dx} size={[12, 6, 2]} pos={[dx - 4, 0, -len / 2 - 1.8]} m={M.plastic} />
      ))}
      <Box size={[8, 9, 22]} pos={[x / 2 - 4, t / 2 - 8, len * 0.12]} m={M.plastic} />
    </group>
  )
}

function Psu({ item }: { item: Item }) {
  const [x, y, z] = item.size
  const body = item.error ? M.error : M.steel
  return (
    <group>
      <Box size={[x, y, z]} m={body} />
      {/* fan grille facing down */}
      <Fan size={Math.min(x, z) - 16} depth={4} axis="y" pos={[0, -y / 2 - 0.5, 0]} frame={M.steel} blade={M.aluDark} />
      {[0.42, 0.3, 0.18].map((k) => (
        <mesh key={k} position={[0, -y / 2 - 2.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[Math.min(x, z) * k, 0.8, 6, 48]} />
          <Std m={M.alu} />
        </mesh>
      ))}
      {/* side label and modular sockets on the front */}
      <Box size={[0.4, y * 0.6, z * 0.55]} pos={[x / 2 + 0.2, 0, 0]} m={M.label} />
      <Box size={[x * 0.75, y * 0.55, 1]} pos={[0, 0, z / 2 + 0.5]} m={M.plastic} />
    </group>
  )
}

function M2({ item }: { item: Item }) {
  return (
    <group>
      <Box size={[1.5, 22, 80]} pos={[-1, 0, 0]} m={item.error ? M.error : M.pcbGreen} />
      <Box size={[1.6, 15, 18]} pos={[0.6, 0, -20]} m={M.plastic} />
      <Box size={[1.6, 15, 18]} pos={[0.6, 0, 4]} m={M.plastic} />
      <Box size={[0.3, 18, 30]} pos={[1.6, 0, -8]} m={M.label} />
    </group>
  )
}

function Drive({ item }: { item: Item }) {
  const [x, y, z] = item.size
  const hdd = item.kind === 'hdd'
  const body = item.error ? M.error : hdd ? M.alu : M.shroud
  return (
    <group>
      <Box size={[x, y, z]} m={body} />
      {hdd && <Box size={[x - 6, 1, z - 30]} pos={[0, y / 2 + 0.4, -10]} m={M.aluDark} />}
      <Box size={[x * 0.7, 0.4, z * 0.45]} pos={[0, y / 2 + (hdd ? 1.1 : 0.2), hdd ? 30 : 0]} m={M.label} />
    </group>
  )
}

export function ItemModel({ item }: { item: Item }) {
  switch (item.kind) {
    case 'board':
      return <Board item={item} />
    case 'cpu':
      return <Cpu item={item} />
    case 'ram':
      return <Ram item={item} />
    case 'air-cooler':
      return <AirCooler item={item} />
    case 'aio-pump':
      return <AioPump item={item} />
    case 'aio-radiator':
      return <AioRadiator item={item} />
    case 'gpu':
      return <Gpu item={item} />
    case 'psu':
      return <Psu item={item} />
    case 'm2':
      return <M2 item={item} />
    case 'ssd':
    case 'hdd':
      return <Drive item={item} />
  }
}

// ---------------------------------------------------------------- case

export function CaseShell({ box }: { box: Vec3 }) {
  const [W, H, D] = box
  const t = 4
  const frontFans = Math.max(1, Math.min(3, Math.floor((H - 120) / 145)))
  return (
    <group>
      {/* motherboard tray, top, bottom, rear and front panels */}
      <Box size={[t, H, D]} pos={[-W / 2 - t / 2, H / 2, 0]} m={M.steel} />
      <Box size={[W + 2 * t, t, D + 2 * t]} pos={[0, H + t / 2, 0]} m={M.steel} />
      <Box size={[W + 2 * t, t, D + 2 * t]} pos={[0, -t / 2, 0]} m={M.steel} />
      <Box size={[W, H, t]} pos={[0, H / 2, -D / 2 - t / 2]} m={M.steel} />
      <Box size={[W, H, t]} pos={[0, H / 2, D / 2 + t / 2]} m={M.plastic} />
      {/* rear exhaust and front intake fans */}
      <Fan size={120} axis="z" pos={[-W / 2 + 70, H - 90, -D / 2 + 14]} />
      {Array.from({ length: frontFans }, (_, i) => (
        <Fan key={i} size={140} axis="z" flip pos={[0, H - 95 - i * 145, D / 2 - 14]} />
      ))}
      {/* tempered glass side panel */}
      <mesh position={[W / 2 + 2, H / 2, 0]}>
        <boxGeometry args={[3, H, D]} />
        <meshPhysicalMaterial color="#dbeafe" transparent opacity={0.13} roughness={0.04} metalness={0} clearcoat={1} depthWrite={false} />
      </mesh>
      {/* feet */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[30, 12, 40]} pos={[sx * (W / 2 - 20), -t - 6, sz * (D / 2 - 35)]} m={M.rubber} />),
      )}
    </group>
  )
}
