import { useEffect, useRef, useState, useCallback } from 'react'
import Silk from '../components/Silk'
import FloatingLines from '../components/FloatingLines'
import MagicRings from '../components/MagicRings'
import Aurora from '../components/Aurora'
import DarkVeil from '../components/DarkVeil'
import GridScan from '../components/GridScan'
import styles from './Wallpaper.module.css'

const ROTATE_MS = 15000
const FADE_MS   = 550   // duration of each half of the fade (matches CSS transition)
const CACHE_KEY = 'cxy_wallpaper_order'

type BgId = 'silk' | 'lines' | 'rings' | 'aurora' | 'darkveil' | 'gridscan'

interface BgEntry { id: BgId; name: string; enabled: boolean }

const DEFAULT_ORDER: BgEntry[] = [
  { id: 'silk',     name: 'Silk',          enabled: true },
  { id: 'lines',    name: 'Floating Lines', enabled: true },
  { id: 'rings',    name: 'Magic Rings',   enabled: true },
  { id: 'aurora',   name: 'Aurora',        enabled: true },
  { id: 'darkveil', name: 'Dark Veil',     enabled: true },
  { id: 'gridscan', name: 'Grid Scan',     enabled: true },
]

function loadOrder(): BgEntry[] {
  try { const r = sessionStorage.getItem(CACHE_KEY); if (r) return JSON.parse(r) } catch {}
  return DEFAULT_ORDER
}
function saveOrder(o: BgEntry[]) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(o)) } catch {}
}

function Background({ id }: { id: BgId }) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {id === 'silk' && (
        <Silk speed={4} scale={1.3} color="#0d1040" noiseIntensity={1.6} rotation={0.2}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      )}
      {id === 'lines' && (
        <FloatingLines
          enabledWaves={['top', 'middle', 'bottom']}
          lineCount={10} lineDistance={9} bendRadius={9} bendStrength={-2.5}
          interactive parallax animationSpeed={0.9}
          linesGradient={['#00d4ff', '#a78bfa', '#4effa8', '#00d4ff']}
          mixBlendMode="screen"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      )}
      {id === 'rings' && (
        <MagicRings
          color="#00d4ff" colorTwo="#a78bfa"
          ringCount={7} speed={1.2} attenuation={8}
          lineThickness={2.5} baseRadius={0.3} radiusStep={0.12}
          scaleRate={0.12} opacity={1} noiseAmount={0.06}
          ringGap={1.5} fadeIn={0.6} fadeOut={0.5}
          followMouse mouseInfluence={0.4} hoverScale={1.2} parallax={0.05} clickBurst
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      )}
      {id === 'aurora' && (
        <div style={{ position: 'absolute', inset: 0, background: '#04040a' }}>
          <Aurora colorStops={['#00d4ff', '#a78bfa', '#4effa8']}
            amplitude={1.2} blend={0.6} speed={1.2}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </div>
      )}
      {id === 'darkveil' && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <DarkVeil hueShift={200} noiseIntensity={0.03} scanlineIntensity={0.08}
            speed={0.6} scanlineFrequency={800} warpAmount={0.4} resolutionScale={0.8} />
        </div>
      )}
      {id === 'gridscan' && (
        <div style={{ position: 'absolute', inset: 0, background: '#04040a' }}>
          <GridScan
            sensitivity={0.55} lineThickness={1} linesColor="#1a1a2e"
            scanColor="#00d4ff" scanOpacity={0.5} gridScale={0.1}
            enablePost bloomIntensity={0.5} chromaticAberration={0.002}
            noiseIntensity={0.01} scanGlow={0.6} scanSoftness={2}
            scanDuration={2.5} scanDelay={1.5}
          />
        </div>
      )}
    </div>
  )
}

export default function Wallpaper() {
  const [order, setOrder]       = useState<BgEntry[]>(loadOrder)
  const [activeIdx, setActiveIdx] = useState(0)
  const [visibleId, setVisibleId] = useState<BgId | null>(null)   // what's actually shown
  const [flash, setFlash]       = useState(false)   // true = black overlay in
  const [progress, setProgress] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragIdx, setDragIdx]   = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const transitioning = useRef(false)
  const startRef      = useRef(Date.now())
  const rafRef        = useRef(0)

  const enabled = order.filter(b => b.enabled)

  // Init visible
  useEffect(() => {
    if (enabled.length > 0 && visibleId === null) setVisibleId(enabled[0].id)
  }, [])

  useEffect(() => {
    document.title = 'codexyy.dev — wallpaper'
    return () => { document.title = 'codexyy.dev — Run code in your browser' }
  }, [])

  const goTo = useCallback((nextIdx: number) => {
    if (transitioning.current) return
    const pool = order.filter(b => b.enabled)
    if (pool.length === 0) return
    const target = pool[nextIdx % pool.length]
    if (!target || target.id === visibleId) { setActiveIdx(nextIdx % pool.length); return }

    transitioning.current = true
    startRef.current = Date.now()

    // Step 1: fade to black
    setFlash(true)
    setTimeout(() => {
      // Step 2: swap background while black
      setVisibleId(target.id)
      setActiveIdx(nextIdx % pool.length)
      // Step 3: fade back in
      setTimeout(() => {
        setFlash(false)
        transitioning.current = false
      }, 80)
    }, FADE_MS)
  }, [order, visibleId])

  // Progress bar + auto-rotate
  useEffect(() => {
    const tick = () => {
      if (!transitioning.current) {
        const elapsed = Date.now() - startRef.current
        setProgress(Math.min((elapsed / ROTATE_MS) * 100, 100))
        if (elapsed >= ROTATE_MS) {
          const pool = order.filter(b => b.enabled)
          goTo((activeIdx + 1) % Math.max(1, pool.length))
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [activeIdx, order, goTo])

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'z' || e.key === 'Z') { setMenuOpen(m => !m); return }
      if (e.key === 'Escape') { setMenuOpen(false); return }
      const pool = order.filter(b => b.enabled)
      if (e.key === 'ArrowRight' && !menuOpen) goTo((activeIdx + 1) % Math.max(1, pool.length))
      if (e.key === 'ArrowLeft'  && !menuOpen) goTo((activeIdx - 1 + pool.length) % Math.max(1, pool.length))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [menuOpen, activeIdx, order, goTo])

  const toggleEnabled = useCallback((id: BgId) => {
    setOrder(prev => {
      const next = prev.map(b => b.id === id ? { ...b, enabled: !b.enabled } : b)
      saveOrder(next)
      return next
    })
    setActiveIdx(0)
    startRef.current = Date.now()
  }, [])

  const onDragStart = (i: number) => setDragIdx(i)
  const onDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOver(i) }
  const onDrop      = (i: number) => {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOver(null); return }
    setOrder(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(i, 0, moved)
      saveOrder(next)
      return next
    })
    setDragIdx(null); setDragOver(null)
    setActiveIdx(0); startRef.current = Date.now()
  }

  const currentName = enabled[activeIdx % Math.max(1, enabled.length)]?.name ?? '—'

  return (
    <div className={styles.root}>
      {/* Single active background */}
      <div className={`${styles.bg} ${styles.bgShow}`}>
        {visibleId && <Background id={visibleId} />}
      </div>

      {/* Fade-to-black overlay */}
      <div className={`${styles.flash} ${flash ? styles.flashIn : styles.flashOut}`} />

      <div className={styles.vignette} />

      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.brandName}>
          <span className={styles.brandWord}>code</span><span className={styles.brandWord}>xyy</span><span className={styles.brandDot}>.</span><span className={styles.brandExt}>dev</span>
        </div>
        <div className={styles.brandMemo}>
          <span className={styles.memoWrite}>write</span>
          <span className={styles.memoDot}>·</span>
          <span className={styles.memoRun}>run</span>
          <span className={styles.memoDot}>·</span>
          <span className={styles.memoShare}>share</span>
        </div>
      </div>

      {/* Status bar */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span className={styles.bgName}>{currentName}</span>
          <div className={styles.dots}>
            {enabled.map((b, i) => (
              <button
                type="button"
                key={b.id}
                className={`${styles.dot} ${i === activeIdx % Math.max(1, enabled.length) ? styles.dotActive : ''}`}
                onClick={() => goTo(i)}
                aria-label={`Show ${b.name}`}
              />
            ))}
          </div>
        </div>
        <div className={styles.hint}>Z — edit  ·  ←→ navigate</div>
      </div>

      {/* Progress bar */}
      <div className={styles.progress} style={{ width: `${progress}%` }} />

      {/* Z menu */}
      {menuOpen && (
        <div className={styles.menuOverlay} role="presentation" onClick={e => { if (e.target === e.currentTarget) setMenuOpen(false) }}>
          <div className={styles.menu}>
            <div className={styles.menuTitle}>Backgrounds — drag to reorder</div>
            <div className={styles.menuList}>
              {order.map((b, i) => (
                <div
                  key={b.id}
                  className={`${styles.menuItem} ${!b.enabled ? styles.menuItemDisabled : ''}`}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={e => onDragOver(e, i)}
                  onDrop={() => onDrop(i)}
                  style={{ opacity: dragOver === i ? 0.5 : 1 }}
                >
                  <span className={styles.menuHandle}>⠿</span>
                  <span className={styles.menuItemName}>{b.name}</span>
                  <button
                    className={`${styles.menuToggle} ${b.enabled ? styles.menuToggleOn : styles.menuToggleOff}`}
                    onClick={() => toggleEnabled(b.id)}
                    aria-label={`${b.enabled ? 'Disable' : 'Enable'} ${b.name}`}
                  />
                </div>
              ))}
            </div>
            <div className={styles.menuFooter}>
              <button className={styles.menuClose} onClick={() => setMenuOpen(false)}>Close  (Z or Esc)</button>
              <span className={styles.menuHint}>saved to session</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
