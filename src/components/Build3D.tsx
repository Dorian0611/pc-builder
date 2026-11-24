// 3D preview of the current build. Loaded lazily (three.js is large), see Build3DPanel.
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { useMemo, useRef, useState, type RefObject } from 'react'
import type { Group } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { layoutBuild, type Item, type Vec3 } from '../lib/layout3d'
import { fullName } from '../lib/specs'
import type { CheckLevel, Part, ResolvedBuild } from '../lib/types'
import { CaseShell, ItemModel } from './three/models'

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

/** A part model that slides in (and grows slightly) the first time it appears. */
function AnimatedItem({ item, onHover }: { item: Item; onHover: (id?: string) => void }) {
  const group = useRef<Group>(null)
  const progress = useRef(0)
  const { pos, from } = item

  useFrame((_, dt) => {
    const g = group.current
    if (!g || progress.current >= 1) return
    progress.current = Math.min(1, progress.current + dt * 1.5)
    const t = 1 - Math.pow(1 - progress.current, 3) // ease-out
    g.position.set(pos[0] + from[0] * (1 - t), pos[1] + from[1] * (1 - t), pos[2] + from[2] * (1 - t))
    g.scale.setScalar(0.85 + 0.15 * t)
  })

  return (
    <group
      ref={group}
      position={[pos[0] + from[0], pos[1] + from[1], pos[2] + from[2]]}
      scale={0.85}
      onPointerOver={(e) => (e.stopPropagation(), onHover(item.partId))}
      onPointerOut={() => onHover(undefined)}
    >
      <ItemModel item={item} />
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
        dpr={[1, 2]}
        camera={{ position: [dist * 0.95, target[1] + dist * 0.35, dist * 0.75], fov: 35 }}
        onPointerDown={() => setInteracted(true)}
      >
        <color attach="background" args={['#eef2f6']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[5, 9, 6]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0005} />
        {/* light inside the case, like the LED strips in a real build */}
        <pointLight position={[W * 0.25 * S, (H - 50) * S, D * 0.2 * S]} intensity={2.2} distance={6} decay={1.2} color="#e0ecff" />
        <pointLight position={[W * 0.3 * S, H * 0.35 * S, D * 0.3 * S]} intensity={1.2} distance={5} decay={1.2} color="#f1f5ff" />
        {/* studio reflections built from local light panels – no HDR download */}
        <Environment resolution={256}>
          <Lightformer intensity={2.2} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
          <Lightformer intensity={1.4} position={[6, 2, 2]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} />
          <Lightformer intensity={0.8} position={[-6, 1, -2]} rotation-y={Math.PI / 2} scale={[8, 4, 1]} color="#c7d2fe" />
          <Lightformer intensity={0.6} position={[0, 1, 6]} scale={[8, 3, 1]} />
        </Environment>

        <group scale={S}>
          {layout.hasCase && <CaseShell box={layout.box} />}
          {layout.items.map((item) => (
            // key includes the part id so swapping a part replays its entry animation
            <AnimatedItem key={`${item.key}:${item.partId}`} item={item} onHover={setHovered} />
          ))}
        </group>
        <ContactShadows position={[0, layout.hasCase ? -0.17 : -0.001, 0]} opacity={0.45} scale={Math.max(W, D) * S * 3} blur={2.4} far={2} />

        <OrbitControls
          ref={controls}
          target={target}
          enablePan={false}
          minDistance={dist * 0.45}
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
      {layout.items.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-500">
          Válassz alkatrészeket – itt épül fel a gép.
        </div>
      )}
    </div>
  )
}
