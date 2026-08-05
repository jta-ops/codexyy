import { useEffect, useState } from 'react'
import styles from './Loader.module.css'
import FloatingLines from './FloatingLines'

export default function Loader({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 80)    // shader + grid
    const t2 = setTimeout(() => setPhase(2), 600)   // scan sweep
    const t3 = setTimeout(() => setPhase(3), 1000)  // chars in
    const t4 = setTimeout(() => setPhase(4), 2400)  // bar + sub in
    const t5 = setTimeout(() => setPhase(5), 4200)  // exit
    const t6 = setTimeout(onDone, 4800)
    return () => [t1, t2, t3, t4, t5, t6].forEach(clearTimeout)
  }, [onDone])

  const logo = 'codexyy'

  return (
    <div className={`${styles.loader} ${phase >= 5 ? styles.exit : ''}`}>
      <div className={`${styles.shader} ${phase >= 1 ? styles.shaderIn : ''}`}>
        <FloatingLines
          enabledWaves={['top', 'middle', 'bottom']}
          lineCount={6}
          lineDistance={8}
          bendRadius={8}
          bendStrength={-2}
          interactive={false}
          parallax={false}
          animationSpeed={0.6}
          linesGradient={['#00d4ff', '#a78bfa', '#00d4ff']}
          mixBlendMode="screen"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      </div>

      <div className={`${styles.grid} ${phase >= 1 ? styles.gridIn : ''}`} />
      <div className={`${styles.scan} ${phase >= 2 ? styles.scanRun : ''}`} />

      <div className={styles.content}>
        <div className={`${styles.logoGlow} ${phase >= 3 ? styles.glowOn : ''}`}>
          <div className={styles.logo}>
            {[...logo].map((ch, i) => (
              <span
                key={i}
                className={`${styles.char} ${phase >= 3 ? styles.charIn : ''}`}
                style={{ transitionDelay: `${i * 55}ms` }}
              >
                {ch}
              </span>
            ))}
            <span
              className={`${styles.char} ${styles.dotChar} ${phase >= 3 ? styles.charIn : ''}`}
              style={{ transitionDelay: `${logo.length * 55}ms` }}
            >
              .
            </span>
            {['d', 'e', 'v'].map((ch, i) => (
              <span
                key={i}
                className={`${styles.char} ${styles.extChar} ${phase >= 3 ? styles.charIn : ''}`}
                style={{ transitionDelay: `${(logo.length + 1 + i) * 55}ms` }}
              >
                {ch}
              </span>
            ))}
          </div>
        </div>

        <div className={`${styles.sub} ${phase >= 4 ? styles.subIn : ''}`}>
          playground
        </div>

        <div className={styles.barTrack}>
          <div className={`${styles.barFill} ${phase >= 4 ? styles.barRun : ''}`} />
        </div>
      </div>

      <div className={`${styles.flash} ${phase >= 5 ? styles.flashGo : ''}`} />
    </div>
  )
}
