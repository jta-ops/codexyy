import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './GitPanel.module.css'

export type GitCommit = {
  sha: string
  short_sha: string
  message: string
  author_name: string
  author_email: string
  date: string
  avatar?: string
  additions: number
  deletions: number
}

export type GitBranch = { name: string; sha: string; protected: boolean }

type Props = {
  repoId: string
  isOwner: boolean
  branch: string
  branches: GitBranch[]
  dirtyPaths: string[]
  committing: boolean
  onCommit: (message: string) => Promise<void>
  onSwitchBranch: (name: string) => void
  onBranchesChanged: () => void
  onRevert: () => void
  refreshKey: number
}

function relTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  if (secs < 2592000) return `${Math.floor(secs / 86400)}d ago`
  return new Date(then).toLocaleDateString()
}

/** Minimal unified-diff colouriser — no external highlighter needed. */
function DiffView({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className={styles.diff}>
      {lines.map((ln, i) => {
        let cls = styles.dCtx
        if (ln.startsWith('+++') || ln.startsWith('---')) cls = styles.dMeta
        else if (ln.startsWith('@@')) cls = styles.dHunk
        else if (ln.startsWith('diff ') || ln.startsWith('index ')) cls = styles.dMeta
        else if (ln.startsWith('+')) cls = styles.dAdd
        else if (ln.startsWith('-')) cls = styles.dDel
        return (
          <div key={i} className={`${styles.dLine} ${cls}`}>
            {ln || ' '}
          </div>
        )
      })}
    </div>
  )
}

export default function GitPanel({
  repoId, isOwner, branch, branches, dirtyPaths, committing,
  onCommit, onSwitchBranch, onBranchesChanged, onRevert, refreshKey,
}: Props) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [openSha, setOpenSha] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [branchOpen, setBranchOpen] = useState(false)
  const [err, setErr] = useState('')
  const msgRef = useRef<HTMLInputElement>(null)

  const loadCommits = useCallback(() => {
    setLoading(true)
    fetch(`/api/repos/${repoId}/commits?ref=${encodeURIComponent(branch)}&limit=50`,
          { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((d: GitCommit[]) => setCommits(Array.isArray(d) ? d : []))
      .catch(() => setCommits([]))
      .finally(() => setLoading(false))
  }, [repoId, branch])

  useEffect(() => { loadCommits() }, [loadCommits, refreshKey])

  async function openDiff(sha: string) {
    if (openSha === sha) { setOpenSha(null); setDiff(''); return }
    setOpenSha(sha); setDiff(''); setDiffLoading(true)
    try {
      const r = await fetch(`/api/repos/${repoId}/commits/${sha}/diff`, { credentials: 'include' })
      const d = await r.json()
      setDiff(d.diff || '(no textual changes)')
    } catch {
      setDiff('(could not load diff)')
    } finally {
      setDiffLoading(false)
    }
  }

  async function doCommit() {
    const m = msg.trim()
    if (!m || !dirtyPaths.length) return
    setErr('')
    try {
      await onCommit(m)
      setMsg('')
      loadCommits()
    } catch (e: any) {
      setErr(e?.message || 'commit failed')
    }
  }

  async function createBranch() {
    const name = newBranch.trim()
    if (!name) return
    setErr('')
    const r = await fetch(`/api/repos/${repoId}/branches`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, from_branch: branch }),
    })
    if (!r.ok) {
      setErr((await r.json().catch(() => ({}))).detail || 'could not create branch')
      return
    }
    setNewBranch('')
    onBranchesChanged()
    onSwitchBranch(name)
  }

  return (
    <div className={styles.root}>
      {/* ── Left rail: branch + working changes + commit box ── */}
      <div className={styles.rail}>
        <div className={styles.section}>
          <div className={styles.sectionHead}>branch</div>
          <div className={styles.branchWrap}>
            <button className={styles.branchBtn} onClick={() => setBranchOpen(o => !o)}>
              <span className={styles.branchIcon}>⑂</span>
              <span className={styles.branchName}>{branch}</span>
              <span className={styles.caret}>{branchOpen ? '▴' : '▾'}</span>
            </button>
            {branchOpen && (
              <div className={styles.branchMenu}>
                {branches.map(b => (
                  <button
                    key={b.name}
                    className={`${styles.branchItem} ${b.name === branch ? styles.branchItemActive : ''}`}
                    onClick={() => { onSwitchBranch(b.name); setBranchOpen(false) }}
                  >
                    <span className={styles.branchIcon}>⑂</span>{b.name}
                    {b.name === branch && <span className={styles.tick}>✓</span>}
                  </button>
                ))}
                {isOwner && (
                  <div className={styles.newBranchRow}>
                    <input
                      className={styles.newBranchInput}
                      placeholder="new-branch"
                      value={newBranch}
                      onChange={e => setNewBranch(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createBranch() }}
                    />
                    <button className={styles.newBranchBtn} onClick={createBranch}>+</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHead}>
            changes
            {dirtyPaths.length > 0 && <span className={styles.count}>{dirtyPaths.length}</span>}
          </div>
          {dirtyPaths.length === 0 ? (
            <div className={styles.clean}>working tree clean</div>
          ) : (
            <>
              <div className={styles.changeList}>
                {dirtyPaths.map(p => (
                  <div key={p} className={styles.changeItem}>
                    <span className={styles.changeMark}>M</span>
                    <span className={styles.changePath} title={p}>{p}</span>
                  </div>
                ))}
              </div>
              {isOwner && (
                <button className={styles.revertBtn} onClick={onRevert}>
                  discard local changes
                </button>
              )}
            </>
          )}
        </div>

        {isOwner && (
          <div className={styles.commitBox}>
            <input
              ref={msgRef}
              className={styles.msgInput}
              placeholder="commit message"
              value={msg}
              onChange={e => setMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doCommit() }}
              disabled={!dirtyPaths.length || committing}
            />
            <button
              className={styles.commitBtn}
              onClick={doCommit}
              disabled={!msg.trim() || !dirtyPaths.length || committing}
            >
              {committing ? 'committing…' : `commit ${dirtyPaths.length || ''}`.trim()}
            </button>
            {err && <div className={styles.err}>{err}</div>}
          </div>
        )}
      </div>

      {/* ── Right: history ── */}
      <div className={styles.history}>
        <div className={styles.sectionHead}>
          history
          <button className={styles.refresh} onClick={loadCommits} title="refresh">⟳</button>
        </div>
        {loading ? (
          <div className={styles.clean}>loading…</div>
        ) : commits.length === 0 ? (
          <div className={styles.clean}>no commits yet</div>
        ) : (
          <div className={styles.commitList}>
            {commits.map(c => (
              <div key={c.sha} className={styles.commitWrap}>
                <button
                  className={`${styles.commit} ${openSha === c.sha ? styles.commitOpen : ''}`}
                  onClick={() => openDiff(c.sha)}
                >
                  <span className={styles.graph}>
                    <span className={styles.dot} />
                    <span className={styles.line} />
                  </span>
                  <span className={styles.cBody}>
                    <span className={styles.cMsg}>{c.message.split('\n')[0]}</span>
                    <span className={styles.cMeta}>
                      <span className={styles.cSha}>{c.short_sha}</span>
                      <span className={styles.cAuthor}>{c.author_name}</span>
                      <span className={styles.cDate}>{relTime(c.date)}</span>
                      {(c.additions > 0 || c.deletions > 0) && (
                        <span className={styles.stat}>
                          <span className={styles.statAdd}>+{c.additions}</span>
                          <span className={styles.statDel}>−{c.deletions}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                {openSha === c.sha && (
                  <div className={styles.diffWrap}>
                    {diffLoading ? <div className={styles.clean}>loading diff…</div>
                                 : <DiffView text={diff} />}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
