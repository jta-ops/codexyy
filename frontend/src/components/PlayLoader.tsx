import { useEffect, useRef, useState } from 'react'
import Silk from './Silk'
import MagicRings from './MagicRings'
import styles from './PlayLoader.module.css'

const WORDS = ['Write.', 'Run.', 'Share.']
const WORD_COLORS = ['#00d4ff', '#4effa8', '#a78bfa']

type Props = { onDone: () => void }

function randomCxCode() {
  const chars = '0123456789ABCDEF'
  let code = 'CX-'
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function playBeep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.5)
    gain.gain.setValueAtTime(0.4, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
    osc.onended = () => ctx.close()
  } catch {}
}

const FORCED_CRASH_CODE = 'CX-DEAD00'
const FORCED_CRASH_CLICKS = 5
const FORCED_CRASH_WINDOW_MS = 1500

// Roll once at module load so it's stable across re-renders
const WILL_CRASH = Math.random() < 0.1

export default function PlayLoader({ onDone }: Props) {
  const [phase, setPhase] = useState(0)
  const [exiting, setExiting] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [showEmail, setShowEmail] = useState(false)
  const [waitlisted, setWaitlisted] = useState(false)
  const [crashed, setCrashed] = useState(false)
  const [crashCode, setCrashCode] = useState(randomCxCode)
  const [skipReady, setSkipReady] = useState(false)
  const [glitching, setGlitching] = useState(false)
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onDoneRef = useRef(onDone)

  function handleLogoClick() {
    clickCountRef.current += 1
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    if (clickCountRef.current >= FORCED_CRASH_CLICKS) {
      clickCountRef.current = 0
      setCrashCode(FORCED_CRASH_CODE)
      playBeep()
      setCrashed(true)
      return
    }
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0 }, FORCED_CRASH_WINDOW_MS)
  }

  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  // Enable 's' key skip after 3s
  useEffect(() => {
    const enableTimer = setTimeout(() => setSkipReady(true), 3000)
    return () => clearTimeout(enableTimer)
  }, [])

  useEffect(() => {
    if (!skipReady) return
    function handleKey(e: KeyboardEvent) {
      if ((e.key === 's' || e.key === 'S') && !glitching) {
        setSkipReady(false)
        setGlitching(true)
        // glitch for a random 1.5–3s then exit
        const glitchDur = 1500 + Math.random() * 1500
        setTimeout(() => {
          setExiting(true)
          setTimeout(() => onDoneRef.current(), 500)
        }, glitchDur)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [skipReady, glitching])

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.email) setEmail(d.email) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (WILL_CRASH) {
      const t1 = setTimeout(() => setPhase(1), 200)
      const t2 = setTimeout(() => setPhase(2), 900)
      const t3 = setTimeout(() => setPhase(3), 1600)
      const crash = setTimeout(() => {
        playBeep()
        setCrashed(true)
      }, 3000)
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(crash) }
    }

    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 900),
      setTimeout(() => setPhase(3), 1600),
      setTimeout(() => setPhase(4), 2800),
      setTimeout(() => setPhase(5), 4000),
      setTimeout(() => setShowEmail(true), 4600),
      setTimeout(() => setWaitlisted(true), 5800),
      setTimeout(() => setPhase(6), 6400),
    ]
    const exitTimer = setTimeout(() => setExiting(true), 9200)
    const doneTimer = setTimeout(() => onDone(), 10000)

    return () => { timers.forEach(clearTimeout); clearTimeout(exitTimer); clearTimeout(doneTimer) }
  }, [onDone])

  if (crashed) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#06000a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
      }}>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 'clamp(52px, 10vw, 80px)',
          fontWeight: 700,
          color: '#ff2040',
          letterSpacing: -2,
          textShadow: '0 0 80px rgba(255,32,64,0.5), 0 0 20px rgba(255,32,64,0.8)',
          animation: 'none',
        }}>
          error
        </div>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 16,
          color: 'rgba(255,32,64,0.6)',
          letterSpacing: '0.35em',
          textTransform: 'uppercase',
          marginTop: 4,
        }}>
          {crashCode}
        </div>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          color: 'rgba(255,255,255,0.15)',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          marginTop: 8,
        }}>
          playground runtime fault
        </div>
        <button
          style={{
            marginTop: 40,
            padding: '9px 32px',
            background: 'rgba(255,32,64,0.1)',
            border: '1px solid rgba(255,32,64,0.25)',
            borderRadius: 6,
            color: 'rgba(255,32,64,0.8)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
          onClick={() => window.location.reload()}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,32,64,0.2)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,32,64,0.1)')}
        >
          retry
        </button>
      </div>
    )
  }

  return (
    <div className={`${styles.root} ${exiting ? styles.exit : ''} ${glitching ? styles.glitch : ''}`}>
      {/* Silk shader background */}
      <div className={styles.silk}>
        <Silk
          speed={4}
          scale={1.2}
          color="#0d1040"
          noiseIntensity={1.8}
          rotation={0.3}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      </div>

      {/* Magic Rings centered */}
      <div className={styles.rings}>
        <MagicRings
          color="#00d4ff"
          colorTwo="#a78bfa"
          ringCount={6}
          speed={1.4}
          attenuation={10}
          lineThickness={2}
          baseRadius={0.35}
          radiusStep={0.1}
          scaleRate={0.1}
          opacity={0.9}
          noiseAmount={0.08}
          ringGap={1.5}
          fadeIn={0.7}
          fadeOut={0.5}
          followMouse
          mouseInfluence={0.3}
          hoverScale={1.15}
          parallax={0.04}
          clickBurst
        />
      </div>

      <div className={styles.overlay} />

      <div className={styles.stage}>
        <div
          className={`${styles.logoWrap} ${phase >= 1 ? styles.logoIn : ''}`}
          onClick={handleLogoClick}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') handleLogoClick() }}
          role="button"
          tabIndex={0}
          aria-label="Codexyy playground"
          style={{ cursor: 'default' }}
        >
          <span className={styles.logo}>
            codexyy<span className={styles.logoDot}>.dev</span>
          </span>
          <span className={`${styles.sub} ${phase >= 2 ? styles.subIn : ''}`}>playground</span>
        </div>

        <div className={`${styles.divider} ${phase >= 3 ? styles.dividerIn : ''}`} />

        <div className={`${styles.wordRow} ${phase >= 4 ? styles.wordRowIn : ''}`}>
          {WORDS.map((w, i) => (
            <span
              key={w}
              className={styles.word}
              style={{ color: WORD_COLORS[i], transitionDelay: `${i * 140}ms`, textShadow: `0 0 28px ${WORD_COLORS[i]}66` }}
            >
              {w}
            </span>
          ))}
        </div>

        <p className={`${styles.tagline} ${phase >= 5 ? styles.taglineIn : ''}`}>
          Monaco editor · 15 languages · live execution · shareable links
        </p>

        {/* Email / waitlist status */}
        {email && (
          <p style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            letterSpacing: '0.12em',
            margin: '0 0 20px',
            opacity: showEmail ? 1 : 0,
            transform: showEmail ? 'translateY(0)' : 'translateY(6px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease, color 0.6s ease',
            color: waitlisted ? 'rgba(78,255,168,0.7)' : 'rgba(0,212,255,0.45)',
          }}>
            {waitlisted ? `✓ ${email} — added to beta waitlist` : `· ${email}`}
          </p>
        )}

        <div className={`${styles.cta} ${phase >= 6 ? styles.ctaIn : ''}`}>
          <span className={styles.ctaDot} />
          {glitching ? <span className={styles.glitchText}>loading</span> : 'loading playground'}
        </div>

        {skipReady && !exiting && !glitching && (
          <div style={{
            position: 'absolute',
            bottom: 48,
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            color: 'rgba(255,255,255,0.18)',
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            animation: 'fadeInSlow 1s ease both',
          }}>
            press s to skip
          </div>
        )}
      </div>

      <div className={styles.barWrap}>
        <div className={`${styles.bar} ${phase >= 1 ? styles.barRun : ''}`} />
      </div>

      <div className={`${styles.cornerTL} ${phase >= 1 ? styles.cornerIn : ''}`}>
        codexyy.dev / playground
      </div>
    </div>
  )
}
