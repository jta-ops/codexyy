import { motion, useMotionValue, useAnimationFrame, useTransform } from 'framer-motion'
import { useRef } from 'react'

interface ShinyTextProps {
  text: string
  speed?: number
  className?: string
  color?: string
  shineColor?: string
  spread?: number
}

export default function ShinyText({
  text,
  speed = 3,
  className = '',
  color = '#7878a0',
  shineColor = '#e2e2ec',
  spread = 100,
}: ShinyTextProps) {
  const progress = useMotionValue(0)
  const elapsed = useRef(0)
  const last = useRef<number | null>(null)

  useAnimationFrame(time => {
    if (last.current === null) { last.current = time; return }
    elapsed.current += time - last.current
    last.current = time
    const p = (elapsed.current % (speed * 1000)) / (speed * 1000) * 100
    progress.set(p)
  })

  const bgPos = useTransform(progress, p => `${150 - p * 2}% center`)

  return (
    <motion.span
      className={className}
      style={{
        backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundPosition: bgPos as any,
        display: 'inline',
      }}
    >
      {text}
    </motion.span>
  )
}
