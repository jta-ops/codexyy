import styles from './Providers.module.css'
import { useInView } from '../hooks/useInView'

const providers = [
  { name: 'Claude (Sonnet)', tag: 'claude-sonnet-4-6 - default', logo: '◆', primary: true },
  { name: 'Claude (Opus)', tag: 'claude-opus-4-7 - most capable', logo: '◆' },
  { name: 'Claude (Haiku)', tag: 'claude-haiku-4-5 - fastest', logo: '◆' },
  { name: 'Ollama', tag: 'qwen, llama, phi - local models', logo: '⟳', local: true },
  { name: 'codexyy hosted', tag: 'Pro plan - no key required', logo: '⬡', hosted: true },
]

export default function Providers() {
  const { ref, inView } = useInView()
  return (
    <section className={styles.section} id="providers">
      <div className={styles.inner}>
        <div className={`${styles.header} ${styles.reveal} ${inView ? styles.visible : ''}`} ref={ref as any}>
          <span className={styles.label}>Models</span>
          <h2 className={styles.title}>Powered by Claude</h2>
          <p className={styles.sub}>
            codexyy runs on Anthropic Claude by default. Switch models with <code>/model</code> -
            or run a local model via Ollama with zero extra setup.
          </p>
        </div>
        <div className={styles.grid}>
          {providers.map((p, i) => (
            <ProviderCard key={p.name} p={p} delay={i * 60} />
          ))}
        </div>
        <p className={styles.note}>
          Switch model any time: <code>/model claude-opus-4-7</code>. Local Ollama models work out of the box if Ollama is running.
        </p>
      </div>
    </section>
  )
}

function ProviderCard({ p, delay }: { p: typeof providers[0]; delay: number }) {
  const { ref, inView } = useInView()
  return (
    <div
      ref={ref as any}
      className={`${styles.card} ${p.hosted ? styles.hostedCard : ''} ${p.primary ? styles.primaryCard : ''} ${styles.reveal} ${inView ? styles.visible : ''}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <div className={styles.logo} style={{ color: p.primary ? 'var(--accent)' : undefined }}>{p.logo}</div>
      <div className={styles.info}>
        <div className={styles.name}>{p.name}</div>
        <div className={styles.tag}>{p.tag}</div>
      </div>
      {p.local && <span className={styles.badge} style={{ background: 'rgba(78,255,168,0.1)', color: 'var(--accent)', border: '1px solid rgba(78,255,168,0.3)' }}>Local</span>}
      {p.hosted && <span className={styles.badge} style={{ background: 'rgba(255,107,53,0.1)', color: '#ff6b35', border: '1px solid rgba(255,107,53,0.3)' }}>Pro</span>}
    </div>
  )
}
