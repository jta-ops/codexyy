import styles from './WhatWeDo.module.css'
import { Link } from '../router'

const pros = [
  {
    title: 'Zero infrastructure cost',
    body: 'The entire stack runs for free. The Piston execution API, our backend, and the frontend all cost nothing to operate during development and early launch.',
  },
  {
    title: '80+ languages out of the box',
    body: 'Piston supports over 80 languages including Python, JavaScript, TypeScript, Go, Rust, C, C++, Java, Ruby, PHP, and dozens more. No custom runtime work required.',
  },
  {
    title: 'No account required for execution',
    body: 'Piston is a public API with no API key. Users can run code the second they land on the page with zero friction.',
  },
  {
    title: 'Ships in days, not months',
    body: 'By using Piston as the execution layer we skip the hardest part of building a code runner: sandboxing. The result is a working product in days.',
  },
  {
    title: 'Already have the server',
    body: 'The frontend and API backend are already running on a VPS with Nginx and a SQLite database. No new infrastructure to provision.',
  },
  {
    title: 'Cloudflare is already active',
    body: 'Cloudflare sits in front of the site providing DDoS protection, caching, and SSL automatically with no monthly cost.',
  },
]

const cons = [
  {
    title: 'Piston is rate limited',
    fix: 'We add a thin rate-limit layer on our own API (max N runs per IP per minute) so Piston never sees burst traffic. We also debounce the Run button on the frontend and queue requests client-side.',
  },
  {
    title: 'Piston can go down',
    fix: 'We implement a retry-with-backoff on failed requests and show a friendly "execution service temporarily unavailable" message. When traffic grows we switch to a self-hosted Piston instance on a $6/mo Hetzner VPS.',
  },
  {
    title: 'No SLA or uptime guarantee',
    fix: 'We monitor the Piston endpoint with a lightweight health-check cron job. If it has been down for more than two minutes we surface a status banner on the site automatically.',
  },
  {
    title: 'Execution timeout is fixed',
    fix: 'Piston enforces a hard timeout per run. We show a clear timeout error in the output panel and let users know the limit. Infinite loops get a clean "Execution timed out" message instead of hanging.',
  },
  {
    title: 'Users can spam execution',
    fix: 'Our FastAPI backend sits in front of Piston and enforces per-IP rate limits using a simple in-memory sliding-window counter. Abusive IPs get a 429 response before the request ever hits Piston.',
  },
  {
    title: 'No user accounts at launch',
    fix: 'Snippets are saved as short URL hashes in SQLite and stored in localStorage for history. Full accounts are a phase-two feature once we have real users who want to save work long-term.',
  },
  {
    title: 'SQLite does not scale to many concurrent writes',
    fix: 'Snippet saves are append-only and infrequent. SQLite handles this fine up to thousands of daily users. We migrate to Supabase free tier (PostgreSQL) when we hit real write pressure.',
  },
  {
    title: 'Single server is a single point of failure',
    fix: 'Cloudflare caches static assets so the site remains available during brief downtime. Critical API responses (snippet reads) are cached at the edge. We set up a $0 uptime monitor via BetterUptime free tier.',
  },
  {
    title: 'No stdin support in initial version',
    fix: 'We add a collapsible stdin panel below the editor in the first iteration. It ships as a text area that gets passed as standard input to the Piston run call.',
  },
  {
    title: 'Cold start latency on first run',
    fix: 'On page load we send a silent preflight ping to the Piston API to warm the connection. The actual Run press feels instant because the TCP handshake has already happened.',
  },
]

export default function WhatWeDo() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Link to="/" className={styles.logo}>
          <span>codexyy</span><span className={styles.logoDot}>.dev</span>
        </Link>
        <span className={styles.navTag}>devlog</span>
      </nav>

      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.meta}>
            <span className={styles.tag}>Architecture</span>
            <span className={styles.dot} />
            <time className={styles.date}>May 2026</time>
          </div>
          <h1 className={styles.title}>
            How we are building codexyy playground for free
          </h1>
          <p className={styles.lead}>
            A transparent breakdown of every technology choice we are making to go from zero to a working code runner without spending a dollar. Every tradeoff, every known problem, and exactly how we plan to fix each one.
          </p>
          <div className={styles.divider} />
        </header>

        <section className={styles.section}>
          <p className={styles.body}>
            Building a code playground sounds simple until you get to the part where you actually run untrusted code from strangers on the internet. Proper sandboxing requires Docker, gVisor, seccomp profiles, and either a dedicated server or a cloud provider that lets you run nested containers. None of that is free.
          </p>
          <p className={styles.body}>
            Instead of building the execution layer ourselves we are using <span className={styles.inline}>Piston</span>, an open source polyglot execution engine maintained by Engineer Man. It handles the sandboxing, supports 80+ languages, and exposes a clean public HTTP API. Our job is to build the editor, the share layer, and the product around it.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>What is working in our favour</h2>
          <div className={styles.prosGrid}>
            {pros.map((p, i) => (
              <div key={i} className={styles.proCard}>
                <span className={styles.proCheck}>+</span>
                <div>
                  <div className={styles.proTitle}>{p.title}</div>
                  <div className={styles.proBody}>{p.body}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Known problems and how we fix them</h2>
          <p className={styles.body}>
            Every free-tier architecture has tradeoffs. We are not pretending these problems do not exist. Here is each one and our exact plan to deal with it.
          </p>
          <div className={styles.consList}>
            {cons.map((c, i) => (
              <div key={i} className={styles.conRow}>
                <div className={styles.conHeader}>
                  <span className={styles.conNum}>{String(i + 1).padStart(2, '0')}</span>
                  <span className={styles.conTitle}>{c.title}</span>
                  <span className={styles.conBadge}>known risk</span>
                </div>
                <div className={styles.conFix}>
                  <span className={styles.fixLabel}>fix</span>
                  <p className={styles.fixBody}>{c.fix}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>The stack in one line</h2>
          <div className={styles.stackBox}>
            <span className={styles.stackItem}><span className={styles.stackLabel}>Editor</span>Monaco</span>
            <span className={styles.stackSep}>/</span>
            <span className={styles.stackItem}><span className={styles.stackLabel}>API</span>FastAPI</span>
            <span className={styles.stackSep}>/</span>
            <span className={styles.stackItem}><span className={styles.stackLabel}>Execution</span>Piston</span>
            <span className={styles.stackSep}>/</span>
            <span className={styles.stackItem}><span className={styles.stackLabel}>DB</span>SQLite</span>
            <span className={styles.stackSep}>/</span>
            <span className={styles.stackItem}><span className={styles.stackLabel}>CDN</span>Cloudflare</span>
          </div>
        </section>

        <footer className={styles.footer}>
          <Link to="/" className={styles.back}>Back to codexyy.dev</Link>
        </footer>
      </main>
    </div>
  )
}
