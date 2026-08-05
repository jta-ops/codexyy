import { useRef } from 'react'

interface SpotlightCardProps {
  children: React.ReactNode
  className?: string
  spotlightColor?: string
}

export default function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(0, 212, 255, 0.12)',
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    ref.current!.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    ref.current!.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
    ref.current!.style.setProperty('--spotlight-color', spotlightColor)
  }

  return (
    <div ref={ref} onMouseMove={handleMouseMove} className={`spotlight-card ${className}`}>
      {children}
    </div>
  )
}
