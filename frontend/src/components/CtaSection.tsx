import { Link } from '../router'
import styles from './CtaSection.module.css'
import { useInView } from '../hooks/useInView'
import FloatingLines from './FloatingLines'

export default function CtaSection() {
  const { ref, inView } = useInView()

  return (
    <section className={styles.section} id="cta">
      <FloatingLines
        enabledWaves={['middle', 'bottom']}
        lineCount={6}
        lineDistance={6}
        bendRadius={6}
        bendStrength={-1.5}
        interactive
        parallax
        animationSpeed={0.7}
        linesGradient={['#00d4ff', '#a78bfa', '#4effa8']}
        mixBlendMode="screen"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.7 }}
      />
      <div className={styles.inner}>
        <div className={`${styles.content} ${styles.reveal} ${inView ? styles.visible : ''}`} ref={ref as any}>
          <span className={styles.label}>Private beta</span>
          <h2 className={styles.title}>It's ready. Go use it.</h2>
          <p className={styles.sub}>
            Sign in with email or Google to get access.
            Takes about 10 seconds and you're in.
          </p>
          <Link to="/play" className={styles.btn}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2.5 2l8 4.5-8 4.5V2z" fill="currentColor"/>
            </svg>
            Open playground
          </Link>
          <p className={styles.note}>No spam. No credit card. Just verify you're human.</p>
        </div>
      </div>
    </section>
  )
}
