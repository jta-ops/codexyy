import { motion } from 'framer-motion'
import { useEffect, useRef, useState, useMemo } from 'react'

const buildKeyframes = (from: Record<string, any>, steps: Record<string, any>[]) => {
  const keys = new Set([...Object.keys(from), ...steps.flatMap(s => Object.keys(s))])
  const keyframes: Record<string, any[]> = {}
  keys.forEach(k => { keyframes[k] = [from[k], ...steps.map(s => s[k])] })
  return keyframes
}

interface BlurTextProps {
  text?: string
  delay?: number
  className?: string
  animateBy?: 'words' | 'letters'
  direction?: 'top' | 'bottom'
  threshold?: number
  stepDuration?: number
  onAnimationComplete?: () => void
}

export default function BlurText({
  text = '',
  delay = 120,
  className = '',
  animateBy = 'words',
  direction = 'top',
  threshold = 0.1,
  stepDuration = 0.35,
  onAnimationComplete,
}: BlurTextProps) {
  const elements = animateBy === 'words' ? text.split(' ') : text.split('')
  const [inView, setInView] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect() } },
      { threshold }
    )
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [threshold])

  const defaultFrom = useMemo(
    () => direction === 'top'
      ? { filter: 'blur(10px)', opacity: 0, y: -30 }
      : { filter: 'blur(10px)', opacity: 0, y: 30 },
    [direction]
  )

  const defaultTo = useMemo(() => [
    { filter: 'blur(4px)', opacity: 0.6, y: direction === 'top' ? 4 : -4 },
    { filter: 'blur(0px)', opacity: 1, y: 0 },
  ], [direction])

  const stepCount = defaultTo.length + 1
  const totalDuration = stepDuration * (stepCount - 1)
  const times = Array.from({ length: stepCount }, (_, i) => stepCount === 1 ? 0 : i / (stepCount - 1))

  return (
    <p ref={ref} className={className} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.28em' }}>
      {elements.map((segment, i) => (
        <motion.span
          key={i}
          style={{ display: 'inline-block', willChange: 'transform, filter, opacity' }}
          initial={defaultFrom}
          animate={inView ? buildKeyframes(defaultFrom, defaultTo) : defaultFrom}
          transition={{ duration: totalDuration, times, delay: (i * delay) / 1000, ease: 'easeOut' }}
          onAnimationComplete={i === elements.length - 1 ? onAnimationComplete : undefined}
        >
          {segment}
        </motion.span>
      ))}
    </p>
  )
}
