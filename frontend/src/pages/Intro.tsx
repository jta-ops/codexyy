import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '../router'
import FloatingLines from '../components/FloatingLines'
import styles from './Intro.module.css'

const LOGO = 'codexyy'
const EXT = ['d', 'e', 'v']
const WORDS = ['Write.', 'Run.', 'Share.']
const WORD_COLORS = ['#00d4ff', '#4effa8', '#a78bfa']
const STATS = ['80+ languages', 'instant execution', 'share via URL']

export default function Intro() {
  const navigate = useNavigate()
  const [p, setP] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)

  // ── Phase timeline ──
  useEffect(() => {
    const ts = [
      [150,  1],
      [700,  2],
      [1100, 3],
      [2300, 4],
      [2700, 5],
      [3300, 6],
      [3700, 7],
      [5100, 8],
      [6300, 9],
      [7500, 10],
      [8900, 11],
      [9500, 12],
    ]
    const timers = ts.map(([ms, phase]) => setTimeout(() => setP(phase), ms))
    const done = setTimeout(() => {
      localStorage.setItem('cxy_intro', Date.now().toString())
      navigate('/', { state: { skipLoader: true } })
    }, 10000)

    const skip = (e: KeyboardEvent) => {
      if (e.key !== 's') return
      timers.forEach(clearTimeout)
      clearTimeout(done)
      setP(11)
      setTimeout(() => setP(12), 300)
      setTimeout(() => {
        localStorage.setItem('cxy_intro', Date.now().toString())
        navigate('/', { state: { skipLoader: true } })
      }, 700)
    }
    window.addEventListener('keydown', skip)

    return () => { timers.forEach(clearTimeout); clearTimeout(done); window.removeEventListener('keydown', skip) }
  }, [navigate])

  // ── Particle canvas ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const W = () => canvas.width
    const H = () => canvas.height

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    type P = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; r: number; hue: number }
    const particles: P[] = []
    const spawn = () => {
      if (particles.length > 120) return
      const cx = W() / 2
      const cy = H() / 2
      const angle = Math.random() * Math.PI * 2
      const dist = 80 + Math.random() * 260
      particles.push({
        x: cx + Math.cos(angle) * dist * 0.1,
        y: cy + Math.sin(angle) * dist * 0.1,
        vx: Math.cos(angle) * (0.4 + Math.random() * 0.8),
        vy: Math.sin(angle) * (0.4 + Math.random() * 0.8),
        life: 0,
        maxLife: 90 + Math.random() * 80,
        r: 0.8 + Math.random() * 1.4,
        hue: Math.random() > 0.5 ? 195 : 270,
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, W(), H())
      if (particles.length < 80) spawn()

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.x += p.vx
        p.y += p.vy
        p.life++
        const t = p.life / p.maxLife
        const alpha = t < 0.2 ? t / 0.2 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${alpha * 0.45})`
        ctx.fill()
        if (p.life >= p.maxLife) particles.splice(i, 1)
      }
      rafRef.current = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const isFading = p >= 11
  const isFlash  = p >= 12

  return (
    <div className={`${styles.root} ${isFading ? styles.fadeOut : ''}`}>
      {/* FloatingLines background */}
      <div className={`${styles.shader} ${p >= 1 ? styles.shaderIn : ''}`}>
        <FloatingLines
          enabledWaves={['top', 'middle', 'bottom']}
          lineCount={8}
          lineDistance={8}
          bendRadius={8}
          bendStrength={-2}
          interactive
          parallax
          animationSpeed={0.8}
          linesGradient={['#00d4ff', '#a78bfa', '#4effa8', '#00d4ff']}
          mixBlendMode="screen"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      </div>

      {/* Grid */}
      <div className={`${styles.grid} ${p >= 1 ? styles.gridIn : ''}`} />

      {/* Particles */}
      <canvas ref={canvasRef} className={styles.particles} />

      {/* Scan line */}
      <div className={`${styles.scan} ${p >= 2 ? styles.scanGo : ''}`} />

      {/* ── CENTER STAGE ── */}
      <div className={styles.stage}>

        {/* Logo */}
        <div className={styles.logoRow}>
          <div className={`${styles.logoGlow} ${p >= 3 ? styles.glowOn : ''}`}>
            <span className={styles.logo}>
              {[...LOGO].map((ch, i) => (
                <span
                  key={i}
                  className={`${styles.char} ${p >= 3 ? styles.charIn : ''}`}
                  style={{ transitionDelay: `${i * 65}ms` }}
                >
                  {ch}
                </span>
              ))}
              <span
                className={`${styles.char} ${styles.dotChar} ${p >= 4 ? styles.charIn : ''}`}
                style={{ transitionDelay: '0ms' }}
              >
                .
              </span>
              {EXT.map((ch, i) => (
                <span
                  key={i}
                  className={`${styles.char} ${styles.extChar} ${p >= 4 ? styles.charIn : ''}`}
                  style={{ transitionDelay: `${(i + 1) * 60}ms` }}
                >
                  {ch}
                </span>
              ))}
            </span>
          </div>
        </div>

        {/* Playground subtitle */}
        <div className={`${styles.sub} ${p >= 5 ? styles.subIn : ''}`}>
          playground
        </div>

        {/* Divider */}
        <div className={`${styles.divider} ${p >= 6 ? styles.dividerIn : ''}`} />

        {/* Write. Run. Share. */}
        <div className={styles.wordRow}>
          {WORDS.map((w, i) => (
            <span
              key={w}
              className={`${styles.word} ${p >= 7 ? styles.wordIn : ''}`}
              style={{
                transitionDelay: `${i * 160}ms`,
                color: WORD_COLORS[i],
                textShadow: `0 0 32px ${WORD_COLORS[i]}88`,
              }}
            >
              {w}
            </span>
          ))}
        </div>

        {/* Tagline */}
        <p className={`${styles.tagline} ${p >= 8 ? styles.taglineIn : ''}`}>
          Full Monaco editor. Isolated sandbox. Shareable links. No account.
        </p>

        {/* Stats row */}
        <div className={`${styles.statsRow} ${p >= 9 ? styles.statsIn : ''}`}>
          {STATS.map((s, i) => (
            <span
              key={s}
              className={styles.stat}
              style={{ transitionDelay: `${i * 140}ms` }}
            >
              <span className={styles.statDot} />
              {s}
            </span>
          ))}
        </div>

        {/* CTA */}
        <div className={`${styles.cta} ${p >= 10 ? styles.ctaIn : ''}`}>
          <span className={styles.ctaPulse} />
          entering playground
        </div>
      </div>

      {/* Countdown bar */}
      <div className={styles.barWrap}>
        <div className={`${styles.bar} ${p >= 1 ? styles.barRun : ''}`} />
      </div>

      {/* Corner labels */}
      <div className={`${styles.corner} ${styles.cornerTL} ${p >= 1 ? styles.cornerIn : ''}`}>
        codexyy.dev v0.1
      </div>
      <div className={`${styles.corner} ${styles.cornerBR} ${p >= 8 ? styles.cornerIn : ''}`}>
        launching soon
      </div>

      {/* Flash */}
      <div className={`${styles.flash} ${isFlash ? styles.flashGo : ''}`} />
    </div>
  )
}
