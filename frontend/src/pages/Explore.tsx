import { useEffect, useState } from 'react'
import { Link, useNavigate } from '../router'
import styles from './Dashboard.module.css'

const LANG_COLORS: Record<string, string> = {
  python: '#3572A5', javascript: '#f1e05a', typescript: '#2b7489',
  go: '#00ADD8', rust: '#dea584', c: '#555555', 'c++': '#f34b7d',
  java: '#b07219', ruby: '#701516', php: '#4F5D95', swift: '#ffac45',
  kotlin: '#A97BFF', bash: '#89e051', lua: '#000080', r: '#198CE7',
}
const LANG_LABELS: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript',
  go: 'Go', rust: 'Rust', c: 'C', 'c++': 'C++', java: 'Java',
  ruby: 'Ruby', php: 'PHP', swift: 'Swift', kotlin: 'Kotlin',
  bash: 'Bash', lua: 'Lua', r: 'R',
}

function timeAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

type PublicRepo = {
  id: string; name: string; description: string; language: string
  star_count: number; fork_count: number; updated_at: number
  author_name?: string; author_avatar?: string
}

export default function Explore() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<PublicRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    document.title = 'Explore — codexyy.dev'
    return () => { document.title = 'codexyy.dev' }
  }, [])

  useEffect(() => {
    setLoading(true)
    const url = q ? `/api/repos/public?q=${encodeURIComponent(q)}` : '/api/repos/public'
    const ctrl = new AbortController()
    fetch(url, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : [])
      .then(setRepos).catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [q])

  return (
    <div className={styles.root}>
      <header className={styles.nav}>
        <Link to="/" className={styles.logo}>codexyy<span className={styles.logoDot}>.dev</span></Link>
        <div className={styles.navRight}>
          <Link to="/dashboard" className={styles.signOut} style={{ marginRight: 8 }}>my repos</Link>
        </div>
      </header>

      <div className={styles.layout} style={{ gridTemplateColumns: '1fr', maxWidth: 880 }}>
        <main className={styles.main}>
          <div className={styles.mainHeader}>
            <h2 className={styles.mainTitle}>Explore public repos</h2>
          </div>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="search by name or description…"
            style={{
              width: '100%', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
              padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace',
              fontSize: 13, color: '#e2e2ec', outline: 'none', marginBottom: 16,
              boxSizing: 'border-box',
            }}
          />
          {loading ? (
            <div className={styles.loadingGrid}>
              {[1,2,3].map(i => <div key={i} className={styles.skeletonCard} />)}
            </div>
          ) : repos.length === 0 ? (
            <div className={styles.empty}><p>no public repos {q ? 'matching that search' : 'yet'}</p></div>
          ) : (
            <div className={styles.repoList}>
              {repos.map(r => (
                <div key={r.id} className={styles.repoCard} role="link" tabIndex={0} onClick={() => navigate(`/repo/${r.id}`)} onKeyDown={event => { if (event.key === 'Enter') navigate(`/repo/${r.id}`) }}>
                  <div className={styles.repoCardTop}>
                    <div className={styles.repoCardLeft}>
                      <div className={styles.repoNameRow}>
                        <span className={styles.repoName}>{r.author_name ?? '?'} / {r.name}</span>
                      </div>
                      {r.description && <p className={styles.repoDesc}>{r.description}</p>}
                    </div>
                  </div>
                  <div className={styles.repoMeta}>
                    <span className={styles.langDot} style={{ background: LANG_COLORS[r.language] ?? '#888' }} />
                    <span className={styles.langLabel}>{LANG_LABELS[r.language] ?? r.language}</span>
                    {r.star_count > 0 && (<><span className={styles.metaSep}>·</span><span className={styles.metaItem}>★ {r.star_count}</span></>)}
                    {r.fork_count > 0 && (<><span className={styles.metaSep}>·</span><span className={styles.metaItem}>⑂ {r.fork_count}</span></>)}
                    <span className={styles.metaSep}>·</span>
                    <span className={styles.metaItem}>updated {timeAgo(r.updated_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
