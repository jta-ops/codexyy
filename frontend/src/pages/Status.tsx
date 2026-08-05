import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './InfoPage.module.css'

type StatusData = { status: string; checked_at: number; checks: Record<string,{status:string;detail:string;used_percent?:number}> }

export default function Status() {
  const [data, setData] = useState<StatusData | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    document.title = 'System status — codexyy.dev'
    const load = () => fetch('/api/status', { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error('status unavailable')
      return r.json()
    }).then(value => { setData(value); setError(false) }).catch(() => setError(true))
    void load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const overall = error ? 'outage' : data?.status ?? 'degraded'
  return <div className={styles.page}><a className={styles.skip} href="#main">Skip to status</a><Nav/><main id="main" className={styles.main}>
    <section className={styles.hero}><span className={styles.eyebrow}>Live service health</span><h1>Know what is <em>working.</em></h1><p>Current health for the Codexyy API, repositories, downloads, model routes, billing, and storage. This page refreshes every minute.</p></section>
    <div className={styles.statusTop}><span className={`${styles.dot} ${overall === 'degraded' ? styles.degraded : overall === 'outage' ? styles.outage : ''}`}/><strong>{overall === 'operational' ? 'All systems operational' : overall === 'degraded' ? 'Some systems need attention' : 'Service interruption detected'}</strong></div>
    {error && <div className={styles.empty} role="alert">The status API could not be reached. The team should investigate the backend.</div>}
    {data && <section className={styles.card} aria-label="Service checks">{Object.entries(data.checks).map(([name,check]) => <div className={styles.statusRow} key={name}><div><strong>{name[0].toUpperCase()+name.slice(1)}</strong><span>{check.detail}{typeof check.used_percent === 'number' ? ` · ${check.used_percent}% used` : ''}</span></div><b className={styles.badge}>{check.status}</b></div>)}</section>}
  </main><Footer/></div>
}
