// 3D preview of the current build. Loaded lazily (three.js is large), see Build3DPanel.
import { Canvas, useFrame } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import { useMemo, useRef, useState, type RefObject } from 'react'
import type { Group, MeshStandardMaterial } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { layoutBuild, type Shape, type Vec3 } from '../lib/layout3d'
import { fullName } from '../lib/specs'
import type { CheckLevel, Part, ResolvedBuild } from '../lib/types'

const S = 0.01 // mm → scene units
/** Azimuth (around y, from +z) pointing at the glass side panel (+x). */
const GLASS_SIDE = Math.PI / 2
const AZIMUTH_RANGE = 1.25

/** Gently swings the camera back and forth on the glass side until the user grabs it. */
function Sway({ controls }: { controls: RefObject<OrbitControlsImpl | null> }) {
  useFrame(({ clock }) => {
    const c = controls.current
    if (!c) return
    c.setAzimuthalAngle(GLASS_SIDE - 0.25 + Math.sin(clock.elapsedTime * 0.35) * 0.55)
    c.update()
  })
  return null
}

/** One part shape that slides in from `from` and fades in when it first appears. */
function AnimatedShape({ shape, onHover }: { shape: Shape; onHover: (id?: string) => void }) {
  const group = useRef<Group>(null)
  const mat = useRef<MeshStandardMaterial>(null)
  const progress = useRef(0)
  const target = shape.pos
  const from = shape.from ?? [0, 60, 0]
  const finalOpacity = shape.opacity ?? 1

  useFrame((_, dt) => {
    if (progress.current >= 1 || !group.current) return
    progress.current = Math.min(1, progress.current + dt * 1.6)
    const t = 1 - Math.pow(1 - progress.current, 3) // ease-out
    group.current.position.set(
      (target[0] + from[0] * (1 - t)) * S,
      (target[1] + from[1] * (1 - t)) * S,
      (target[2] + from[2] * (1 - t)) * S,
    )
    if (mat.current) mat.current.opacity = finalOpacity * t
  })

  const rotation: Vec3 = shape.axis === 'z' ? [Math.PI / 2, 0, 0] : shape.axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0]
  const hover = {
    onPointerOver: (e: { stopPropagation: () => void }) => (e.stopPropagation(), onHover(shape.partId)),
    onPointerOut: () => onHover(undefined),
  }

  return (
    <group ref={group} position={[(target[0] + from[0]) * S, (target[1] + from[1]) * S, (target[2] + from[2]) * S]}>
      {shape.kind === 'box' ? (
        <mesh {...hover} castShadow>
          <boxGeometry args={[shape.size[0] * S, shape.size[1] * S, shape.size[2] * S]} />
          <meshStandardMaterial ref={mat} color={shape.color} transparent opacity={0} roughness={0.55} metalness={0.25} />
          <Edges color="#1e293b" threshold={20} />
        </mesh>
      ) : (
        <mesh {...hover} rotation={rotation}>
          <cylinderGeometry args={[(shape.size[0] / 2) * S, (shape.size[0] / 2) * S, shape.size[1] * S, 28]} />
          <meshStandardMaterial ref={mat} color={shape.color} transparent opacity={0} roughness={0.8} />
        </mesh>
      )}
    </group>
  )
}

function Case({ box, visible }: { box: Vec3; visible: boolean }) {
  const [W, H, D] = box
  if (!visible)
    return (
      <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W * S * 1.6, D * S * 1.4]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
    )
  return (
    <group>
      {/* glass shell with visible frame */}
      <mesh position={[0, (H / 2) * S, 0]}>
        <boxGeometry args={[(W + 20) * S, (H + 20) * S, (D + 20) * S]} />
        <meshStandardMaterial color="#bfdbfe" transparent opacity={0.08} depthWrite={false} />
        <Edges color="#64748b" />
      </mesh>
      {/* back wall (motherboard tray) and floor are solid */}
      <mesh position={[(-W / 2 - 4) * S, (H / 2) * S, 0]}>
        <boxGeometry args={[4 * S, H * S, D * S]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      <mesh position={[0, -2 * S, 0]} receiveShadow>
        <boxGeometry args={[W * S, 4 * S, D * S]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
    </group>
  )
}

interface Props {
  build: ResolvedBuild
  levels: Map<string, CheckLevel>
  parts: Part[]
}

export default function Build3D({ build, levels, parts }: Props) {
  const layout = useMemo(() => layoutBuild(build, levels), [build, levels])
  const [hovered, setHovered] = useState<string>()
  const [interacted, setInteracted] = useState(false)
  const controls = useRef<OrbitControlsImpl>(null)
  const names = useMemo(() => new Map(parts.map((p) => [p.id, fullName(p)])), [parts])

  const [W, H, D] = layout.box
  const target: Vec3 = [0, (H / 2) * S, 0]
  const dist = Math.max(W, H, D) * S * 1.9

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        camera={{ position: [dist * 0.95, target[1] + dist * 0.35, dist * 0.75], fov: 35 }}
        onPointerDown={() => setInteracted(true)}
      >
        <color attach="background" args={['#f8fafc']} />
        <ambientLight intensity={1.1} />
        <hemisphereLight args={['#ffffff', '#cbd5e1', 0.6]} />
        <directionalLight position={[4, 8, 5]} intensity={1.3} castShadow />
        <directionalLight position={[-3, 2, -4]} intensity={0.3} />
        <Case box={layout.box} visible={layout.hasCase} />
        {layout.shapes.map((s) => (
          // key includes the part id so swapping a part replays its entry animation
          <AnimatedShape key={`${s.key}:${s.partId}`} shape={s} onHover={setHovered} />
        ))}
        <OrbitControls
          ref={controls}
          target={target}
          enablePan={false}
          minDistance={dist * 0.5}
          maxDistance={dist * 2}
          // stay on the glass side: from behind, the motherboard tray hides everything
          minAzimuthAngle={GLASS_SIDE - AZIMUTH_RANGE}
          maxAzimuthAngle={GLASS_SIDE + AZIMUTH_RANGE}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 2 + 0.1}
        />
        {!interacted && <Sway controls={controls} />}
      </Canvas>
      {hovered && names.get(hovered) && (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[90%] truncate rounded bg-slate-900/80 px-2 py-1 text-xs text-white">
          {names.get(hovered)}
        </div>
      )}
      {layout.shapes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-500">
          Válassz alkatrészeket – itt épül fel a gép.
        </div>
      )}
    </div>
  )
}
