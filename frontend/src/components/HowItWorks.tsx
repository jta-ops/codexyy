import styles from './HowItWorks.module.css'
import { useInView } from '../hooks/useInView'
import BlurText from './BlurText'

const steps = [
  {
    num: '01',
    title: 'Open it',
    desc: 'Go to codexyy.dev/play. No sign-up, no extension, no onboarding modal. The editor is just there. Pick a language and start.',
    accent: '#00d4ff',
  },
  {
    num: '02',
    title: 'Write and run',
    desc: 'Type or paste your code. Hit Run. It executes in a real container — stdin, stdout, stderr, the works. Need a package? Install it from the packages tab.',
    accent: '#a78bfa',
  },
  {
    num: '03',
    title: 'Copy the link',
    desc: "Your code auto-saves. The URL is your share link. Send it to anyone — they can view it, run it, and fork it without creating an account.",
    accent: '#4effa8',
  },
]

export default function HowItWorks() {
  const { ref, inView } = useInView()
  return (
    <section className={styles.section} id="how">
      <div className={styles.inner}>
        <div className={`${styles.header} ${styles.reveal} ${inView ? styles.visible : ''}`} ref={ref as any}>
          <span className={styles.label}>How it works</span>
          <BlurText
            text="Three steps, no fluff."
            delay={80}
            animateBy="words"
            className={styles.title}
          />
        </div>
        <div className={styles.steps}>
          {steps.map((s, i) => (
            <StepCard key={s.num} s={s} delay={i * 100} />
          ))}
        </div>
      </div>
    </section>
  )
}

function StepCard({ s, delay }: { s: typeof steps[0]; delay: number }) {
  const { ref, inView } = useInView()
  return (
    <div
      ref={ref as any}
      className={`${styles.step} ${styles.reveal} ${inView ? styles.visible : ''}`}
      style={{ transitionDelay: `${delay}ms`, '--step-accent': s.accent } as any}
    >
      <div className={styles.stepAccentLine} />
      <div className={styles.stepNum} style={{ color: s.accent }}>{s.num}</div>
      <h3 className={styles.stepTitle}>{s.title}</h3>
      <p className={styles.stepDesc}>{s.desc}</p>
    </div>
  )
}
