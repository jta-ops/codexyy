import styles from './ComingSoon.module.css'
import { useInView } from '../hooks/useInView'

const tools = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="2" y="4" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M6 9l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Code Playground',
    desc: 'Write and run code in 80+ languages right in the browser. No install, no config. Powered by an open-source sandbox with Monaco editor - the same editor as VS Code.',
    accent: '#00d4ff',
    detail: ['80+ languages supported', 'Monaco editor with syntax highlighting', 'Share runs via short URL'],
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M4 6h14M4 11h14M4 16h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="17" cy="16" r="3" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M17 14.8v1.2l.8.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Snippet Hub',
    desc: 'Paste, syntax-highlight, and share code snippets with a short URL. No account required. Supports every language, with an embeddable widget for blogs and docs.',
    accent: '#a78bfa',
    detail: ['Short URL for every snippet', 'Embeddable in any webpage', 'All languages, instant highlighting'],
  },
]

export default function ComingSoon() {
  const { ref, inView } = useInView()
  return (
    <section className={styles.section} id="coming-soon">
      <div className={styles.inner}>
        <div className={`${styles.header} ${styles.reveal} ${inView ? styles.visible : ''}`} ref={ref as any}>
          <span className={styles.label}>Coming soon</span>
          <h2 className={styles.title}>More tools on the way</h2>
          <p className={styles.sub}>The CLI agent is just the start. We're building a full suite of developer tools — here's what's coming next.</p>
        </div>
        <div className={styles.grid}>
          {tools.map((t, i) => (
            <ComingSoonCard key={i} t={t} delay={i * 100} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ComingSoonCard({ t, delay }: { t: typeof tools[0]; delay: number }) {
  const { ref, inView } = useInView()
  return (
    <div
      ref={ref as any}
      className={`${styles.card} ${styles.reveal} ${inView ? styles.visible : ''}`}
      style={{ transitionDelay: `${delay}ms`, '--card-accent': t.accent } as any}
    >
      <div className={styles.glowBorder} />
      <div className={styles.topRow}>
        <div className={styles.iconWrap} style={{ color: t.accent, background: `${t.accent}12` }}>{t.icon}</div>
        <span className={styles.badge}>Coming soon</span>
      </div>
      <h3 className={styles.cardTitle}>{t.title}</h3>
      <p className={styles.cardDesc}>{t.desc}</p>
      <ul className={styles.detail}>
        {t.detail.map((d, j) => (
          <li key={j} className={styles.detailItem}>
            <span className={styles.check} style={{ color: t.accent }}>-</span>
            {d}
          </li>
        ))}
      </ul>
      <div className={styles.disabledBtn}>
        <span>Notify me</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6h7M6.5 3.5L9 6l-2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
    </div>
  )
}
