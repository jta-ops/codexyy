import { useEffect, useRef, useState } from 'react'
import { Link } from '../router'
import styles from './Hero.module.css'
import FloatingLines from './FloatingLines'

const outputLines = [
  { text: 'fib(0) = 0',  delay: 1400 },
  { text: 'fib(1) = 1',  delay: 1600 },
  { text: 'fib(2) = 1',  delay: 1800 },
  { text: 'fib(3) = 2',  delay: 2000 },
  { text: 'fib(4) = 3',  delay: 2200 },
  { text: 'fib(5) = 5',  delay: 2400 },
  { text: 'fib(6) = 8',  delay: 2600 },
  { text: 'fib(7) = 13', delay: 2800 },
]

function randomCxCode() {
  const chars = '0123456789ABCDEF'
  let code = 'CX-'
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function detectOS(): 'macos' | 'ios' | 'windows' | 'linux' {
  const ua = navigator.userAgent
  const platform = (navigator as any).userAgentData?.platform ?? navigator.platform ?? ''
  if (/iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Mac/.test(platform) || /Macintosh/.test(ua)) return 'macos'
  if (/Win/.test(platform) || /Windows/.test(ua)) return 'windows'
  return 'linux'
}

function playOsErrorSound() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()

    const os = detectOS()

    const run = () => {
      if (os === 'macos') {
        // Basso-like: deep resonant sine drop
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(196, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(98, ctx.currentTime + 1.2)
        gain.gain.setValueAtTime(0.5, ctx.currentTime)
        gain.gain.setValueAtTime(0.5, ctx.currentTime + 0.6)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2)
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 1.2)
        osc.onended = () => ctx.close()
      } else if (os === 'windows') {
        // Two descending tones
        const play = (freq: number, start: number) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination)
          osc.type = 'sine'
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
          gain.gain.setValueAtTime(0.4, ctx.currentTime + start)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.3)
          osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + 0.3)
          if (start > 0) osc.onended = () => ctx.close()
        }
        play(800, 0)
        play(600, 0.35)
      } else if (os === 'ios') {
        // Short descending sine
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(440, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.25)
        gain.gain.setValueAtTime(0.35, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25)
        osc.onended = () => ctx.close()
      } else {
        // Linux: short bell
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, ctx.currentTime)
        gain.gain.setValueAtTime(0.4, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15)
        osc.onended = () => ctx.close()
      }
    }

    if (ctx.state === 'suspended') ctx.resume().then(run)
    else run()
  } catch {}
}

function smoothScrollTo(el: HTMLElement) {
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  } catch {
    el.scrollIntoView()
  }
}

export default function Hero() {
  const [shownLines, setShownLines] = useState<number[]>([])
  const started = useRef(false)
  const [dotGone, setDotGone] = useState(false)
  const [mockupGone, setMockupGone] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [crashed, setCrashed] = useState(false)
  const [crashCode] = useState(randomCxCode)
  const [highlighted, setHighlighted] = useState(false)
  const dotRef = useRef<HTMLButtonElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  function handleRedDot() {
    if (dotGone) return
    setDotGone(true)
    playOsErrorSound()

    const t = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms)
      timersRef.current.push(id)
    }

    // t=0: hide mockup
    setMockupGone(true)

    // t=500ms: freeze cursor + interaction block
    t(500, () => {
      setFrozen(true)
      document.documentElement.style.cursor = 'wait'
    })

    // t=2000ms: start slow shift
    t(2000, () => {
      document.body.classList.add('site-shifting')
    })

    // t=5500ms: stop shift, start glitch
    t(5500, () => {
      document.body.classList.remove('site-shifting')
      document.body.classList.add('site-glitching')
    })

    // t=10000ms: crash
    t(10000, () => {
      document.body.classList.remove('site-shifting', 'site-glitching')
      document.documentElement.style.cursor = ''
      setCrashed(true)
    })
  }

  // Clean up body classes if component unmounts mid-sequence
  useEffect(() => {
    return () => {
      document.body.classList.remove('site-shifting', 'site-glitching')
      document.documentElement.style.cursor = ''
      timersRef.current.forEach(clearTimeout)
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    outputLines.forEach((l, i) => {
      setTimeout(() => setShownLines(v => [...v, i]), l.delay)
    })
  }, [])

  useEffect(() => {
    function triggerHighlight() {
      if (dotRef.current) smoothScrollTo(dotRef.current)
      setHighlighted(true)
      setTimeout(() => setHighlighted(false), 3000)
    }

    if (window.location.hash === '#dot') {
      const t = setTimeout(triggerHighlight, 600)
      return () => clearTimeout(t)
    }

    window.addEventListener('highlight-dot', triggerHighlight)
    return () => window.removeEventListener('highlight-dot', triggerHighlight)
  }, [])

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
    <section className={styles.hero}>
      <FloatingLines
        enabledWaves={['top', 'middle', 'bottom']}
        lineCount={8}
        lineDistance={8}
        bendRadius={8}
        bendStrength={-2}
        interactive
        parallax
        animationSpeed={0.8}
        linesGradient={['#005566', '#2d1f4e', '#0d3322', '#005566']}
        mixBlendMode="screen"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.9 }}
      />
      <div className={styles.grid} aria-hidden />

      <div className={styles.inner}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          <span className={styles.badgeText}>private beta — grab your spot</span>
        </div>

        <h1 className={styles.headline}>
          The code playground<br />
          <span className={styles.headlineAccent}>that gets out of your way.</span>
        </h1>

        <p className={styles.sub}>
          Monaco editor (yes, actual VS Code). 15 languages. Real execution in
          isolated containers. Share anything as a URL. No install, no setup,
          no account wall — just open it and code.
        </p>

        <div className={styles.actions}>
          <Link to="/dashboard" className={styles.primaryBtn}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2.5 2l8 4.5-8 4.5V2z" fill="currentColor"/>
            </svg>
            Get started
          </Link>
          <a href="#how" className={styles.ghostBtn} onClick={e => { e.preventDefault(); document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }) }}>
            How it works
          </a>
        </div>

        <div className={`${styles.mockupWrap} ${mockupGone ? styles.mockupHide : ''}`}>
          <div className={styles.editor}>
            <div className={styles.editorBar}>
              <div className={styles.dots}>
                <button
                  type="button"
                  aria-label="Activate hidden launch animation"
                  ref={dotRef}
                  className={highlighted ? styles.dotHighlight : undefined}
                  style={{ background: dotGone ? 'transparent' : '#ff5f57', cursor: dotGone ? 'default' : 'pointer', transition: 'background 0.15s ease' }}
                  onClick={handleRedDot}
                />
                <span style={{ background: '#febc2e' }} />
                <span style={{ background: '#28c840' }} />
              </div>
              <div className={styles.tabs}>
                <span className={styles.tabActive}>Python</span>
                <span className={styles.tab}>JavaScript</span>
                <span className={styles.tab}>Go</span>
                <span className={styles.tabMore}>+12</span>
              </div>
              <div className={styles.runBtn}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 1.5l6 3.5-6 3.5V1.5z" fill="#07070a" />
                </svg>
                Run
              </div>
            </div>
            <div className={styles.editorBody}>
              <div className={styles.code}>
                <div className={styles.codeLine}>
                  <span className={styles.ln}>1</span>
                  <span><span className={styles.kw}>def </span><span className={styles.fn}>fib</span><span className={styles.pn}>(n):</span></span>
                </div>
                <div className={styles.codeLine}>
                  <span className={styles.ln}>2</span>
                  <span>{'  '}<span className={styles.kw}>if </span><span className={styles.va}>n</span><span className={styles.pn}> &lt;= </span><span className={styles.num}>1</span><span className={styles.pn}>: </span><span className={styles.kw}>return </span><span className={styles.va}>n</span></span>
                </div>
                <div className={styles.codeLine}>
                  <span className={styles.ln}>3</span>
                  <span>{'  '}<span className={styles.kw}>return </span><span className={styles.fn}>fib</span><span className={styles.pn}>(n-</span><span className={styles.num}>1</span><span className={styles.pn}>) + </span><span className={styles.fn}>fib</span><span className={styles.pn}>(n-</span><span className={styles.num}>2</span><span className={styles.pn}>)</span></span>
                </div>
                <div className={styles.codeLine}><span className={styles.ln}>4</span></div>
                <div className={styles.codeLine}>
                  <span className={styles.ln}>5</span>
                  <span><span className={styles.kw}>for </span><span className={styles.va}>i </span><span className={styles.kw}>in </span><span className={styles.bi}>range</span><span className={styles.pn}>(</span><span className={styles.num}>8</span><span className={styles.pn}>):</span></span>
                </div>
                <div className={styles.codeLine}>
                  <span className={styles.ln}>6</span>
                  <span>{'  '}<span className={styles.bi}>print</span><span className={styles.pn}>(</span><span className={styles.st}>f"fib({'{'}i{'}'}) = {'{'}fib(i){'}'}"</span><span className={styles.pn}>)</span></span>
                </div>
              </div>
              <div className={styles.output}>
                <div className={styles.outputLabel}>Output</div>
                {outputLines.map((l, i) => (
                  <div
                    key={i}
                    className={`${styles.outLine} ${shownLines.includes(i) ? styles.outLineVisible : ''}`}
                  >
                    {l.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {frozen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          cursor: 'wait',
          background: 'rgba(4,4,10,0)',
        }} />
      )}
    </section>
  )
}
