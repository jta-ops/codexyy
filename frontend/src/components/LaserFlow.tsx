import { useEffect, useRef } from 'react'

interface Beam {
  x: number
  y: number
  angle: number
  length: number
  width: number
  color: string
  alpha: number
  speed: number
  drift: number
}

const COLORS = ['#4effa8', '#00d4ff', '#4effa8', '#a78bfa', '#4effa8', '#00d4ff', '#ff6b35']

function hexAlpha(hex: string, a: number) {
  const n = Math.round(a * 255).toString(16).padStart(2, '0')
  return hex + n
}

export default function LaserFlow({ style }: { style?: React.CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf: number

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const W = () => canvas.offsetWidth
    const H = () => canvas.offsetHeight

    const beams: Beam[] = Array.from({ length: 10 }, (_, i) => ({
      x: Math.random() * W(),
      y: Math.random() * H(),
      angle: -40 + (Math.random() - 0.5) * 30,
      length: 350 + Math.random() * 350,
      width: 0.6 + Math.random() * 1.2,
      color: COLORS[i % COLORS.length],
      alpha: 0.08 + Math.random() * 0.18,
      speed: 0.15 + Math.random() * 0.35,
      drift: (Math.random() - 0.5) * 0.08,
    }))

    const drawBeam = (beam: Beam) => {
      ctx.save()
      ctx.translate(beam.x, beam.y)
      ctx.rotate((beam.angle * Math.PI) / 180)

      // Core beam
      const grad = ctx.createLinearGradient(0, -beam.length / 2, 0, beam.length / 2)
      grad.addColorStop(0, hexAlpha(beam.color, 0))
      grad.addColorStop(0.25, hexAlpha(beam.color, beam.alpha * 0.6))
      grad.addColorStop(0.5, hexAlpha(beam.color, beam.alpha))
      grad.addColorStop(0.75, hexAlpha(beam.color, beam.alpha * 0.6))
      grad.addColorStop(1, hexAlpha(beam.color, 0))

      ctx.beginPath()
      ctx.lineWidth = beam.width
      ctx.strokeStyle = grad
      ctx.moveTo(0, -beam.length / 2)
      ctx.lineTo(0, beam.length / 2)
      ctx.stroke()

      // Glow halo
      const glow = ctx.createLinearGradient(0, -beam.length / 2, 0, beam.length / 2)
      glow.addColorStop(0, hexAlpha(beam.color, 0))
      glow.addColorStop(0.5, hexAlpha(beam.color, beam.alpha * 0.25))
      glow.addColorStop(1, hexAlpha(beam.color, 0))

      ctx.lineWidth = beam.width * 8
      ctx.strokeStyle = glow
      ctx.stroke()

      ctx.restore()
    }

    const tick = () => {
      ctx.clearRect(0, 0, W(), H())

      for (const b of beams) {
        b.y += b.speed
        b.x += b.drift

        if (b.y - b.length / 2 > H()) {
          b.y = -b.length / 2
          b.x = Math.random() * W()
        }
        if (b.x > W() + b.length) b.x = -b.length
        if (b.x < -b.length) b.x = W() + b.length

        drawBeam(b)
      }

      raf = requestAnimationFrame(tick)
    }

    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        ...style,
      }}
    />
  )
}
