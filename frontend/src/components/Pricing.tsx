import styles from './Pricing.module.css'
import { useInView } from '../hooks/useInView'

const plans = [
  {
    name: 'Free',
    price: '$0',
    sub: 'forever',
    desc: 'Bring your own Anthropic API key. All features, all tools, unlimited sessions. codexyy never touches your key.',
    features: [
      'Full AI coding agent',
      'All 6 tools (read, write, search, bash, ...)',
      'Your own Anthropic API key',
      'Unlimited sessions and messages',
      'Open source CLI',
    ],
    cta: 'Install now',
    ctaHref: '#',
    highlight: false,
  },
  {
    name: 'Pro',
    price: '$5',
    sub: 'per month',
    desc: "Use codexyy's hosted Claude model - no API key required. Just install and code.",
    features: [
      'Everything in Free',
      'Hosted Claude model - no key needed',
      'Priority access during peak hours',
      'Usage dashboard',
      'Cancel any time',
    ],
    cta: 'Start Pro',
    ctaHref: '#',
    highlight: true,
    badge: 'Most popular',
  },
]

export default function Pricing() {
  const { ref, inView } = useInView()
  return (
    <section className={styles.section} id="pricing">
      <div className={styles.inner}>
        <div className={`${styles.header} ${styles.reveal} ${inView ? styles.visible : ''}`} ref={ref as any}>
          <span className={styles.label}>Pricing</span>
          <h2 className={styles.title}>Free forever, or $5 for zero config.</h2>
          <p className={styles.sub}>BYOK is free forever. Pro removes the API key requirement for $5/mo.</p>
        </div>
        <div className={styles.grid}>
          {plans.map((p, i) => (
            <PlanCard key={p.name} p={p} delay={i * 120} />
          ))}
        </div>
        <div className={styles.footnote}>
          No credit card needed for Free. Pro billing via Stripe, cancel any time.
        </div>
      </div>
    </section>
  )
}

function PlanCard({ p, delay }: { p: typeof plans[0]; delay: number }) {
  const { ref, inView } = useInView()
  return (
    <div
      ref={ref as any}
      className={`${styles.card} ${p.highlight ? styles.highlighted : ''} ${styles.reveal} ${inView ? styles.visible : ''}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {p.badge && (
        <div className={`${styles.badge} ${p.highlight ? styles.badgeHighlight : styles.badgeNeutral}`}>
          {p.badge}
        </div>
      )}
      <div className={styles.planName}>{p.name}</div>
      <div className={styles.price}>
        <span className={styles.priceMain}>{p.price}</span>
        <span className={styles.priceSub}>{p.sub}</span>
      </div>
      <p className={styles.planDesc}>{p.desc}</p>
      <ul className={styles.features}>
        {p.features.map((f, i) => (
          <li key={i} className={styles.feature}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={styles.checkIcon}>
              <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {f}
          </li>
        ))}
      </ul>
      <a href={p.ctaHref} className={`${styles.cta} ${p.highlight ? styles.ctaHighlight : styles.ctaDefault}`}>
        {p.cta}
      </a>
    </div>
  )
}
