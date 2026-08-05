import { useEffect, useState } from 'react'
import { useNavigate, Link } from '../router'
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
const LANGUAGES = Object.keys(LANG_LABELS)

function timeAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

type Repo = {
  id: string; name: string; description: string; language: string
  private: number; star_count: number; fork_count: number
  file_count: number; updated_at: number; created_at: number
}
type User = {
  name: string; email: string; avatar?: string; plan?: string
  plan_amount?: number; stripe_sub_id?: string
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newLang, setNewLang] = useState('python')
  const [newPrivate, setNewPrivate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importErr, setImportErr] = useState('')
  const [search, setSearch] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 5) return 'Working late'
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()
  const filteredRepos = repos.filter(r =>
    !search.trim() ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.description ?? '').toLowerCase().includes(search.toLowerCase())
  )

  async function importRepo() {
    if (!importUrl.trim() || importing) return
    setImporting(true); setImportErr('')
    try {
      const r = await fetch('/api/repos/import', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim(), private: false }),
      })
      const d = await r.json()
      if (!r.ok) { setImportErr(d.detail ?? 'Import failed') }
      else if (d.id) navigate(`/repo/${d.id}`)
    } catch { setImportErr('Network error') }
    setImporting(false)
  }

  useEffect(() => {
    document.title = 'Dashboard — codexyy.dev'
    return () => { document.title = 'codexyy.dev' }
  }, [])

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { window.location.href = '/auth/login?next=/dashboard'; return }
        setUser(d)
      })
      .catch(() => { window.location.href = '/auth/login?next=/dashboard' })
  }, [])

  useEffect(() => {
    if (!user) return
    fetch('/api/repos/mine', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setRepos)
      .catch(() => setRepos([]))
      .finally(() => setLoading(false))
  }, [user])

  async function createRepo() {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const r = await fetch('/api/repos', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), language: newLang, private: newPrivate }),
      })
      const d = await r.json()
      if (d.id) navigate(`/repo/${d.id}`)
    } catch {}
    setCreating(false)
  }

  async function deleteRepo(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    setDeletingId(id)
    try {
      await fetch(`/api/repos/${id}`, { method: 'DELETE', credentials: 'include' })
      setRepos(r => r.filter(x => x.id !== id))
    } catch {}
    setDeletingId(null)
  }

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Sign out failed')
      window.location.replace('/')
    } catch {
      setSigningOut(false)
    }
  }

  return (
    <div className={styles.root}>
      {/* Top nav */}
      <header className={styles.nav}>
        <Link to="/" className={styles.logo}>codexyy<span className={styles.logoDot}>.dev</span></Link>
        <div className={styles.navRight}>
          {user?.avatar
            ? <img src={user.avatar} className={styles.avatar} alt="" />
            : <div className={styles.avatarFallback}>{user?.name?.[0]?.toUpperCase() ?? '?'}</div>
          }
          <span className={styles.userName}>{user?.name}</span>
          <Link to="/pro" className={styles.planChip}>
            {user?.plan === 'pro_max' ? 'Pro Max' : user?.plan === 'pro' ? 'Pro' : 'Free'}
          </Link>
          <button type="button" className={styles.signOut} onClick={signOut} disabled={signingOut}>
            {signingOut ? 'signing out…' : 'sign out'}
          </button>
        </div>
      </header>

      <div className={styles.layout}>
        {/* Left sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            {user?.avatar
              ? <img src={user.avatar} className={styles.sidebarAvatar} alt="" />
              : <div className={`${styles.sidebarAvatar} ${styles.avatarFallback}`}>{user?.name?.[0]?.toUpperCase() ?? '?'}</div>
            }
            <div className={styles.sidebarName}>{user?.name}</div>
            <div className={styles.sidebarEmail}>{user?.email}</div>
          </div>
          <Link to="/play" className={styles.sidebarLink}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8V1.5Z"/></svg>
            Quick snippet
          </Link>
          <Link to="/agent/start" className={styles.sidebarLink}>Start isolated agent</Link>
          <Link to="/preview" className={styles.sidebarLink}>Artifact studio</Link>
        </aside>

        {/* Main */}
        <main className={styles.main}>
          {new URLSearchParams(window.location.search).get('subscribed') === '1' && (
            <div className={styles.subscriptionBanner} role="status">
              <strong>Subscription confirmed.</strong>
              <span>Your hosted Pro models are ready. If the plan badge is still updating, refresh in a moment.</span>
            </div>
          )}
          <div className={styles.welcome}>
            <div className={styles.welcomeGreet}>{greeting} ·</div>
            <h1 className={styles.welcomeTitle}>
              Hello, <span className={styles.welcomeAccent}>{user?.name?.split(' ')[0] ?? 'there'}</span>
            </h1>
            <p className={styles.welcomeSub}>
              {repos.length === 0
                ? 'Spin up your first codespace below.'
                : `You have ${repos.length} ${repos.length === 1 ? 'repo' : 'repos'}. Pick one or start something new.`}
            </p>
          </div>

          {repos.length > 3 && (
            <div className={styles.searchWrap}>
              <span className={styles.searchIcon}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 7a4.499 4.499 0 1 1-8.998 0A4.499 4.499 0 0 1 11.5 7Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"/></svg>
              </span>
              <input
                className={styles.searchInput}
                placeholder="Find a repository…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          )}

          <div className={styles.mainHeader}>
            <h2 className={styles.mainTitle}>repositories</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link to="/explore" className={styles.cancelBtn} style={{ textDecoration: 'none' }}>Explore</Link>
              <button className={styles.cancelBtn} onClick={() => setShowImport(true)}>Import from GitHub</button>
            <button className={styles.newBtn} onClick={() => setShowNew(true)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>
              New
            </button>
            </div>
          </div>

          {loading ? (
            <div className={styles.loadingGrid}>
              {[1,2,3].map(i => <div key={i} className={styles.skeletonCard} />)}
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className={styles.empty}>
              <svg width="48" height="48" viewBox="0 0 16 16" fill="currentColor" style={{opacity:0.15}}>
                <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8V1.5Z"/>
              </svg>
              <p>No repos yet</p>
              <button className={styles.newBtn} onClick={() => setShowNew(true)}>Create your first repo</button>
            </div>
          ) : (
            <div className={styles.repoList}>
              {filteredRepos.map(repo => (
                <div key={repo.id} className={styles.repoCard} role="link" tabIndex={0} onClick={() => navigate(`/repo/${repo.id}`)} onKeyDown={event => { if (event.key === 'Enter') navigate(`/repo/${repo.id}`) }}>
                  <div className={styles.repoCardTop}>
                    <div className={styles.repoCardLeft}>
                      <div className={styles.repoNameRow}>
                        <span className={styles.repoName}>{repo.name}</span>
                        {repo.private ? <span className={styles.privateBadge}>private</span> : <span className={styles.publicBadge}>public</span>}
                      </div>
                      {repo.description && <p className={styles.repoDesc}>{repo.description}</p>}
                    </div>
                    <button
                      className={styles.deleteBtn}
                      onClick={e => { e.stopPropagation(); deleteRepo(repo.id, repo.name) }}
                      disabled={deletingId === repo.id}
                      title="Delete repo"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
                    </button>
                  </div>
                  <div className={styles.repoMeta}>
                    <span className={styles.langDot} style={{ background: LANG_COLORS[repo.language] ?? '#888' }} />
                    <span className={styles.langLabel}>{LANG_LABELS[repo.language] ?? repo.language}</span>
                    <span className={styles.metaSep}>·</span>
                    <span className={styles.metaItem}>{repo.file_count} file{repo.file_count !== 1 ? 's' : ''}</span>
                    <span className={styles.metaSep}>·</span>
                    <span className={styles.metaItem}>updated {timeAgo(repo.updated_at)}</span>
                    {repo.star_count > 0 && (
                      <><span className={styles.metaSep}>·</span>
                      <span className={styles.metaItem}>★ {repo.star_count}</span></>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* New repo modal */}
      {showNew && (
        <div className={styles.modalOverlay} role="presentation" onClick={event => { if (event.target === event.currentTarget) setShowNew(false) }}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="new-repo-title">
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle} id="new-repo-title">New repository</h3>
              <button className={styles.modalClose} onClick={() => setShowNew(false)} aria-label="Close new repository dialog">×</button>
            </div>
            <div className={styles.modalBody}>
              <label className={styles.fieldLabel} htmlFor="new-repo-name">Name <span className={styles.required}>*</span></label>
              <input
                id="new-repo-name"
                className={styles.fieldInput}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createRepo()}
                placeholder="my-project"
                autoFocus
              />
              <label className={styles.fieldLabel} htmlFor="new-repo-description">Description</label>
              <input
                id="new-repo-description"
                className={styles.fieldInput}
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Optional description"
              />
              <label className={styles.fieldLabel} htmlFor="new-repo-language">Language</label>
              <select id="new-repo-language" className={styles.fieldSelect} value={newLang} onChange={e => setNewLang(e.target.value)}>
                {LANGUAGES.map(l => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
              </select>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={newPrivate} onChange={e => setNewPrivate(e.target.checked)} />
                <span>Private repo</span>
              </label>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setShowNew(false)}>Cancel</button>
              <button className={styles.createBtn} onClick={createRepo} disabled={!newName.trim() || creating}>
                {creating ? 'Creating…' : 'Create repo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className={styles.modalOverlay} role="presentation" onClick={event => { if (event.target === event.currentTarget) setShowImport(false) }}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="import-repo-title">
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle} id="import-repo-title">Import from GitHub</h3>
              <button className={styles.modalClose} onClick={() => setShowImport(false)} aria-label="Close import dialog">×</button>
            </div>
            <div className={styles.modalBody}>
              <label className={styles.fieldLabel} htmlFor="import-repo-url">GitHub URL</label>
              <input
                id="import-repo-url"
                className={styles.fieldInput}
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && importRepo()}
                placeholder="https://github.com/owner/repo"
                autoFocus
              />
              {importErr && <p style={{ color: '#ff5f57', fontSize: 12, margin: 0, fontFamily: 'JetBrains Mono, monospace' }}>{importErr}</p>}
              <p style={{ fontSize: 11, color: '#3a3a52', margin: 0, fontFamily: 'JetBrains Mono, monospace' }}>
                Imports up to 40 text files under 200KB each. Binary files are skipped.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setShowImport(false)}>Cancel</button>
              <button className={styles.createBtn} onClick={importRepo} disabled={!importUrl.trim() || importing}>
                {importing ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
