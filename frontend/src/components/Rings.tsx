import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function RingMesh({ radius, tube, speed, tiltX, tiltZ, color }: {
  radius: number; tube: number; speed: number; tiltX: number; tiltZ: number; color: string
}) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += speed * delta
  })
  return (
    <mesh ref={ref} rotation={[tiltX, 0, tiltZ]}>
      <torusGeometry args={[radius, tube, 4, 80]} />
      <meshBasicMaterial color={color} transparent opacity={0.18} side={THREE.DoubleSide} />
    </mesh>
  )
}

function GlowRing({ radius, tube, speed, tiltX, tiltZ, color }: {
  radius: number; tube: number; speed: number; tiltX: number; tiltZ: number; color: string
}) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += speed * delta
  })
  return (
    <mesh ref={ref} rotation={[tiltX, 0, tiltZ]}>
      <torusGeometry args={[radius, tube, 2, 80]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} />
    </mesh>
  )
}

type RingsProps = { style?: React.CSSProperties }

export default function Rings({ style }: RingsProps) {
  return (
    <Canvas camera={{ position: [0, 0, 6], fov: 50 }} style={style}>
      <ambientLight intensity={0.1} />

      {/* Outer slow rings */}
      <RingMesh radius={3.2} tube={0.012} speed={0.18}  tiltX={1.1}  tiltZ={0.3}  color="#00d4ff" />
      <RingMesh radius={2.8} tube={0.010} speed={-0.14} tiltX={0.7}  tiltZ={1.0}  color="#a78bfa" />
      <RingMesh radius={2.4} tube={0.014} speed={0.22}  tiltX={1.4}  tiltZ={-0.5} color="#4effa8" />

      {/* Mid rings */}
      <RingMesh radius={1.9} tube={0.012} speed={-0.3}  tiltX={0.4}  tiltZ={1.3}  color="#00d4ff" />
      <RingMesh radius={1.5} tube={0.010} speed={0.35}  tiltX={1.8}  tiltZ={0.2}  color="#a78bfa" />

      {/* Glowing thin inner rings */}
      <GlowRing  radius={1.1} tube={0.004} speed={-0.5}  tiltX={0.9}  tiltZ={0.7}  color="#00d4ff" />
      <GlowRing  radius={0.7} tube={0.003} speed={0.65}  tiltX={1.3}  tiltZ={-0.3} color="#4effa8" />
    </Canvas>
  )
}
