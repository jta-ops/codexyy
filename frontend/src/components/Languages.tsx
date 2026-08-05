import styles from './Languages.module.css'
import { useInView } from '../hooks/useInView'
import BlurText from './BlurText'

const HOT = new Set(['Python', 'JavaScript', 'TypeScript', 'Go', 'Rust', 'C++', 'Java'])

const langs = [
  'Python','JavaScript','TypeScript','Go','Rust','C++','Java',
  'C','C#','Kotlin','Swift','Ruby','PHP','Haskell','Lua','R',
  'Perl','Scala','Clojure','Dart','Elixir','Erlang','F#','Julia',
  'OCaml','Nim','Zig','Bash','PowerShell','Assembly','Brainfuck',
]

export default function Languages() {
  const { ref, inView } = useInView()
  const { ref: gridRef, inView: gridIn } = useInView()

  return (
    <section className={styles.section} id="languages">
      <div className={styles.inner}>
        <div className={`${styles.header} ${styles.reveal} ${inView ? styles.visible : ''}`} ref={ref as any}>
          <span className={styles.label}>Languages</span>
          <BlurText
            text="80+ languages. All sandboxed."
            delay={80}
            animateBy="words"
            className={styles.title}
          />
          <p className={styles.sub}>
            From Python to Zig — every language runs in an isolated environment.
            Switch instantly, no installs, no conflicts.
          </p>
        </div>
        <div
          ref={gridRef as any}
          className={`${styles.grid} ${styles.reveal} ${gridIn ? styles.visible : ''}`}
          style={{ transitionDelay: '100ms' }}
        >
          {langs.map((l, i) => (
            <span
              key={l}
              className={`${styles.pill} ${HOT.has(l) ? styles.hot : ''}`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {l}
            </span>
          ))}
          <span className={`${styles.pill} ${styles.more}`}>+ 50 more</span>
        </div>
      </div>
    </section>
  )
}
