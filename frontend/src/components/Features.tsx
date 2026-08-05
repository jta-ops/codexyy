import styles from './Features.module.css'
import { useInView } from '../hooks/useInView'
import SpotlightCard from './SpotlightCard'
import BlurText from './BlurText'

const features = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="2" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M6 9l3 3-3 3M12 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Actually VS Code',
    desc: "Not a Monaco wrapper that kind of works. The real engine — same IntelliSense, same multi-cursor, same keybindings. Your muscle memory already knows how to use it.",
    accent: '#00d4ff',
    detail: ['IntelliSense + autocomplete', 'Multi-cursor, column select', 'All VS Code shortcuts'],
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7.5 11l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Real execution',
    desc: "Code runs inside actual containers via Piston. stdin works. stderr shows. You can install packages. It's not a toy — it runs the same code your terminal would.",
    accent: '#4effa8',
    detail: ['stdin / stdout / stderr', 'pip, npm, gem packages', 'Isolated per run'],
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M8 4H5a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V9l-5-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M13 4v5h5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7.5 13.5l1.5-3 1.5 3M8 12.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Share the whole thing',
    desc: "Copy the URL. That's it. Whoever opens it sees your exact code. They can run it, fork it, change it. No login wall, no preview mode, no stripped-down viewer.",
    accent: '#a78bfa',
    detail: ['Auto-saves as you type', 'Anyone can run it', 'Owner keeps edit rights'],
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M11 7v4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: '15 languages',
    desc: "Python, JavaScript, TypeScript, Go, Rust, C, C++, Java, Ruby, PHP, Swift, Kotlin, Bash, Lua, R. More coming. Each one is a real runtime, not a transpiler.",
    accent: '#ff6b35',
    detail: ['Compiled + interpreted', 'No artificial limits', 'Same runtimes, every time'],
  },
]

export default function Features() {
  const { ref, inView } = useInView()
  return (
    <section className={styles.section} id="features">
      <div className={styles.inner}>
        <div className={`${styles.header} ${styles.reveal} ${inView ? styles.visible : ''}`} ref={ref as any}>
          <span className={styles.label}>What's in it</span>
          <BlurText
            text="No compromises."
            delay={80}
            animateBy="words"
            className={styles.title}
          />
          <p className={styles.sub}>We've been burned by playgrounds that look great in screenshots but break on anything real. This one doesn't.</p>
        </div>
        <div className={styles.grid}>
          {features.map((f, i) => (
            <FeatureCard key={i} f={f} delay={i * 80} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({ f, delay }: { f: typeof features[0]; delay: number }) {
  const { ref, inView } = useInView()
  return (
    <div
      ref={ref as any}
      className={`${styles.reveal} ${inView ? styles.visible : ''}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <SpotlightCard
        className={styles.card}
        spotlightColor={`${f.accent}18`}
      >
        <div className={styles.cardInner} style={{ '--card-accent': f.accent } as any}>
          <div className={styles.topBar} />
          <div className={styles.iconWrap} style={{ color: f.accent, background: `${f.accent}12` }}>
            {f.icon}
          </div>
          <h3 className={styles.cardTitle}>{f.title}</h3>
          <p className={styles.cardDesc}>{f.desc}</p>
          <ul className={styles.detail}>
            {f.detail.map((d, j) => (
              <li key={j} className={styles.detailItem}>
                <span style={{ color: f.accent }}>—</span>
                {d}
              </li>
            ))}
          </ul>
        </div>
      </SpotlightCard>
    </div>
  )
}
