import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from '../router'
import Editor from '@monaco-editor/react'
import PlayLoader from '../components/PlayLoader'
import GitPanel, { type GitBranch } from '../components/GitPanel'
import styles from './RepoPlayground.module.css'

const MONACO_LANG: Record<string, string> = {
  python: 'python', javascript: 'javascript', typescript: 'typescript',
  go: 'go', rust: 'rust', c: 'c', 'c++': 'cpp', java: 'java',
  ruby: 'ruby', php: 'php', swift: 'swift', kotlin: 'kotlin',
  bash: 'shell', lua: 'lua', r: 'r',
}

const LANG_EXT: Record<string, string[]> = {
  python: ['.py'], javascript: ['.js', '.mjs', '.cjs'], typescript: ['.ts'],
  go: ['.go'], rust: ['.rs'], c: ['.c'], 'c++': ['.cpp', '.cc', '.cxx'],
  java: ['.java'], ruby: ['.rb'], php: ['.php'], swift: ['.swift'],
  kotlin: ['.kt'], bash: ['.sh'], lua: ['.lua'], r: ['.r', '.R'],
}
const LANG_DEFAULT_ENTRY: Record<string, string> = {
  python: 'main.py', javascript: 'main.js', typescript: 'main.ts',
  go: 'main.go', rust: 'main.rs', c: 'main.c', 'c++': 'main.cpp',
  java: 'Main.java', ruby: 'main.rb', php: 'main.php',
  swift: 'main.swift', kotlin: 'main.kt', bash: 'main.sh',
  lua: 'main.lua', r: 'main.r',
}

function pickEntry(files: { path: string }[], lang: string, activePath?: string): string | undefined {
  const exts = LANG_EXT[lang] ?? []
  const matches = (p: string) => exts.some(e => p.toLowerCase().endsWith(e))
  if (activePath && matches(activePath)) return activePath
  const def = LANG_DEFAULT_ENTRY[lang]
  if (def && files.some(f => f.path === def)) return def
  const first = files.find(f => matches(f.path))
  if (first) return first.path
  return files[0]?.path
}

type RepoFile = { path: string; content: string }
type TermLine = { text: string; err?: boolean }

export default function RepoPlayground() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loaderDone, setLoaderDone] = useState(false)

  const [files, setFiles] = useState<RepoFile[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [repoName, setRepoName] = useState('')
  const [language, setLanguage] = useState('python')
  const [isOwner, setIsOwner] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const [starred, setStarred] = useState(false)
  const [starCount, setStarCount] = useState(0)
  const [forkCount, setForkCount] = useState(0)
  const [forking, setForking] = useState(false)
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'unsaved'>('idle')
  const [running, setRunning] = useState(false)
  const [termLines, setTermLines] = useState<TermLine[]>([])
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined)
  const [outputOpen, setOutputOpen] = useState(true)
  const [stdinInput, setStdinInput] = useState('')
  const [panelTab, setPanelTab] = useState<'output' | 'shell' | 'packages' | 'git'>('output')
  // Git state. `committed` is the last-known state of the branch in git; the
  // editor buffer is the working tree, so dirty paths are a straight diff.
  const [branch, setBranch] = useState('main')
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [committed, setCommitted] = useState<Record<string, string>>({})
  const [committing, setCommitting] = useState(false)
  const [gitRefresh, setGitRefresh] = useState(0)
  const [packages, setPackages] = useState<string[]>([])
  const [pkgInput, setPkgInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [shellLines, setShellLines] = useState<string>('')
  const [shellInput, setShellInput] = useState('')
  const [shellOpen, setShellOpen] = useState(false)
  const shellWsRef = useRef<WebSocket | null>(null)
  const shellInputRef = useRef<HTMLInputElement>(null)
  const shellOutRef = useRef<HTMLDivElement>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const stdoutBufRef = useRef('')
  const wsRef = useRef<WebSocket | null>(null)
  const termBottomRef = useRef<HTMLDivElement>(null)
  const stdinRef = useRef<HTMLInputElement>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])
  const branchRef = useRef(branch)
  useEffect(() => { branchRef.current = branch }, [branch])
  const pkgsRef = useRef(packages)
  useEffect(() => { pkgsRef.current = packages }, [packages])

  async function savePackages(next: string[]) {
    setPackages(next)
    if (!isOwner) return
    await fetch(`/api/repos/${id}/packages`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: next }),
    }).catch(() => {})
  }
  function addPackage() {
    const p = pkgInput.trim()
    if (!p || packages.includes(p)) { setPkgInput(''); return }
    savePackages([...packages, p])
    setPkgInput('')
  }
  function removePackage(p: string) { savePackages(packages.filter(x => x !== p)) }
  async function scanPackages() {
    setScanning(true)
    try {
      const r = await fetch(`/api/repos/${id}/scan`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      const merged = Array.from(new Set([...packages, ...(d.detected ?? [])]))
      if (merged.length !== packages.length) await savePackages(merged)
    } catch {}
    setScanning(false)
  }

  const draftKey = useCallback((b: string) => `cxy_draft_${id}_${b}`, [id])

  const loadRepo = useCallback((ref?: string) => {
    if (!id) return
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    fetch(`/api/repos/${id}${q}`, { credentials: 'include' })
      .then(r => {
        if (r.status === 404 || r.status === 403) { setNotFound(true); return null }
        return r.json()
      })
      .then(d => {
        if (!d) return
        setRepoName(d.name)
        setLanguage(d.language)
        setIsOwner(d.is_owner)
        setStarred(d.starred ?? false)
        setStarCount(d.star_count ?? 0)
        setForkCount(d.fork_count ?? 0)
        setPackages(d.packages ?? [])
        setBranches(d.branches ?? [])
        const b = d.branch || 'main'
        setBranch(b)

        const fromGit: RepoFile[] = (d.files ?? [])
          .map((f: any) => ({ path: f.path, content: f.content }))
        setCommitted(Object.fromEntries(fromGit.map(f => [f.path, f.content])))

        // Restore an uncommitted draft if one survived a reload.
        let restored: RepoFile[] | null = null
        try {
          const raw = localStorage.getItem(draftKey(b))
          if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length) restored = parsed
          }
        } catch { /* corrupt draft — fall back to git */ }

        setFiles(restored ?? fromGit)
        setActiveIdx(0)
        setSaveStatus(restored ? 'unsaved' : 'idle')
      })
      .catch(() => setNotFound(true))
  }, [id, draftKey])

  useEffect(() => { loadRepo() }, [loadRepo])

  useEffect(() => { termBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [termLines])

  /**
   * The editor buffer is a working tree, not a save target: it is persisted
   * locally so nothing is lost on reload, but it only reaches the server when
   * the user commits. Autosaving straight to git would produce a commit every
   * 1.5 seconds and make history worthless.
   */
  function markUnsaved() {
    setSaveStatus('unsaved')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (!isOwner) return
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(branchRef.current),
                             JSON.stringify(filesRef.current))
      } catch { /* quota — the buffer is still in memory */ }
    }, 600)
  }

  const dirtyPaths = (() => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const f of files) {
      seen.add(f.path)
      if (committed[f.path] !== f.content) out.push(f.path)
    }
    for (const p of Object.keys(committed)) if (!seen.has(p)) out.push(p)
    return out.sort()
  })()

  const commitChanges = useCallback(async (message: string) => {
    if (!id) return
    setCommitting(true)
    setSaveStatus('saving')
    try {
      const r = await fetch(`/api/repos/${id}/files`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: filesRef.current, message, branch: branchRef.current, prune: true,
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.detail || `commit failed (${r.status})`)
      }
      setCommitted(Object.fromEntries(filesRef.current.map(f => [f.path, f.content])))
      try { localStorage.removeItem(draftKey(branchRef.current)) } catch {}
      setSaveStatus('saved')
      setGitRefresh(k => k + 1)
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (e) {
      setSaveStatus('unsaved')
      throw e
    } finally {
      setCommitting(false)
    }
  }, [id, draftKey])

  function discardChanges() {
    if (!confirm('Discard all uncommitted changes and reload from git?')) return
    try { localStorage.removeItem(draftKey(branchRef.current)) } catch {}
    loadRepo(branchRef.current)
  }

  function switchBranch(name: string) {
    if (name === branchRef.current) return
    if (dirtyPaths.length &&
        !confirm(`You have ${dirtyPaths.length} uncommitted change(s). They stay saved on "${branchRef.current}". Switch to "${name}"?`)) return
    loadRepo(name)
  }

  function updateFile(idx: number, content: string) {
    setFiles(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], content }
      return next
    })
    markUnsaved()
  }

  function addFile() {
    const name = prompt('File name:')
    if (!name?.trim()) return
    const path = name.trim().replace(/^\/+/, '')
    if (files.some(f => f.path === path)) return
    setFiles(prev => [...prev, { path, content: '' }])
    setActiveIdx(files.length)
    markUnsaved()
  }

  function deleteFile(idx: number) {
    if (files.length <= 1) return
    if (!confirm(`Delete "${files[idx].path}"?`)) return
    setFiles(prev => prev.filter((_, i) => i !== idx))
    setActiveIdx(i => Math.min(i, files.length - 2))
    markUnsaved()
  }

  function ensureAudio() {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.preload = 'auto'
    }
    return audioRef.current
  }

  function handleAudioCmd(cmd: any) {
    const a = ensureAudio()
    if (cmd.cmd === 'load' && cmd.data) {
      a.src = `data:${cmd.mime || 'audio/mpeg'};base64,${cmd.data}`
      a.load()
    } else if (cmd.cmd === 'play') {
      a.play().catch(() => {})
    } else if (cmd.cmd === 'stop') {
      a.pause(); a.currentTime = 0
    } else if (cmd.cmd === 'pause') {
      a.pause()
    } else if (cmd.cmd === 'vol') {
      a.volume = Math.max(0, Math.min(1, cmd.v ?? 1))
    } else if (cmd.cmd === 'sfx' && cmd.data) {
      const sfx = new Audio(`data:${cmd.mime || 'audio/wav'};base64,${cmd.data}`)
      sfx.play().catch(() => {})
    }
  }

  function processStdout(chunk: string): string {
    stdoutBufRef.current += chunk
    let buf = stdoutBufRef.current
    let visible = ''
    let i = 0
    while (i < buf.length) {
      const markIdx = buf.indexOf('\x00CXY_AUD:', i)
      if (markIdx === -1) {
        visible += buf.slice(i)
        i = buf.length
        break
      }
      visible += buf.slice(i, markIdx)
      const nl = buf.indexOf('\n', markIdx)
      if (nl === -1) {
        // partial, save rest for next chunk
        stdoutBufRef.current = buf.slice(markIdx)
        return visible
      }
      const json = buf.slice(markIdx + 9, nl)
      try { handleAudioCmd(JSON.parse(json)) } catch {}
      i = nl + 1
    }
    stdoutBufRef.current = ''
    return visible
  }

  const run = useCallback(() => {
    if (running) {
      wsRef.current?.send(JSON.stringify({ type: 'kill' }))
      wsRef.current?.close()
      wsRef.current = null
      setRunning(false)
      return
    }
    setTermLines([])
    setExitCode(undefined)
    setOutputOpen(true)
    setRunning(true)
    stdoutBufRef.current = ''
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/run`)
    wsRef.current = ws
    ws.onopen = () => ws.send(JSON.stringify({
      language,
      files: filesRef.current.map(f => ({ name: f.path, content: f.content })),
      entry: pickEntry(filesRef.current, language, filesRef.current[activeIdx]?.path),
      packages: pkgsRef.current,
    }))
    ws.onmessage = e => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'stdout') {
        const visible = processStdout(msg.data)
        if (visible) setTermLines(p => [...p, { text: visible }])
      }
      else if (msg.type === 'stderr') setTermLines(p => [...p, { text: msg.data, err: true }])
      else if (msg.type === 'started') stdinRef.current?.focus()
      else if (msg.type === 'exit') { setExitCode(msg.code); setRunning(false); wsRef.current = null }
      else if (msg.type === 'error') { setTermLines(p => [...p, { text: msg.data, err: true }]); setRunning(false); wsRef.current = null }
    }
    ws.onclose = () => { setRunning(false); wsRef.current = null }
  }, [running, language, activeIdx])

  function sendStdin() {
    const data = stdinInput + '\n'
    setStdinInput('')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stdin', data }))
      setTermLines(p => [...p, { text: data }])
    }
  }

  async function toggleStar() {
    const r = await fetch(`/api/repos/${id}/star`, { method: 'POST', credentials: 'include' }).catch(() => null)
    if (!r?.ok) return
    const d = await r.json()
    setStarred(d.starred)
    setStarCount(c => d.starred ? c + 1 : c - 1)
  }

  async function forkRepo() {
    if (forking) return
    setForking(true)
    const r = await fetch(`/api/repos/${id}/fork`, { method: 'POST', credentials: 'include' }).catch(() => null)
    setForking(false)
    if (!r?.ok) return
    const d = await r.json()
    if (d.id) { setForkCount(c => c + 1); navigate(`/repo/${d.id}`) }
  }

  function openShell() {
    if (shellWsRef.current || !id) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/shell/${id}`)
    shellWsRef.current = ws
    ws.onmessage = e => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'stdout' || msg.type === 'stderr') {
        setShellLines(s => s + msg.data)
      } else if (msg.type === 'ready') {
        setShellOpen(true)
        setTimeout(() => shellInputRef.current?.focus(), 50)
      }
    }
    ws.onclose = () => {
      shellWsRef.current = null
      setShellOpen(false)
      setShellLines(s => s + '\n[shell closed]\n')
    }
  }

  function closeShell() {
    shellWsRef.current?.send(JSON.stringify({ type: 'kill' }))
    shellWsRef.current?.close()
    shellWsRef.current = null
    setShellOpen(false)
  }

  function sendShell() {
    if (!shellWsRef.current || shellWsRef.current.readyState !== WebSocket.OPEN) return
    const cmd = shellInput + '\n'
    setShellInput('')
    setShellLines(s => s + '$ ' + cmd)
    shellWsRef.current.send(JSON.stringify({ type: 'stdin', data: cmd }))
  }

  useEffect(() => () => { shellWsRef.current?.close() }, [])
  useEffect(() => { shellOutRef.current?.scrollTo({ top: shellOutRef.current.scrollHeight }) }, [shellLines])

  function startRename(idx: number) {
    setRenamingIdx(idx)
    setRenameVal(files[idx].path)
  }

  function commitRename(idx: number) {
    const trimmed = renameVal.trim().replace(/^\/+/, '')
    if (trimmed && trimmed !== files[idx].path && !files.some((f, i) => i !== idx && f.path === trimmed)) {
      setFiles(prev => prev.map((f, i) => i === idx ? { ...f, path: trimmed } : f))
      markUnsaved()
    }
    setRenamingIdx(null)
  }

  async function saveRepoName(name: string) {
    const trimmed = name.trim()
    if (!trimmed || !isOwner) return
    setRepoName(trimmed)
    await fetch(`/api/repos/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => {})
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [run])

  if (!loaderDone) return <PlayLoader onDone={() => setLoaderDone(true)} />

  if (notFound) return (
    <div className={styles.error}>
      <p>Repo not found or private.</p>
      <Link to="/dashboard" className={styles.backLink}>← Back to dashboard</Link>
    </div>
  )

  const hasError = exitCode !== undefined && exitCode !== null && exitCode !== 0
  const activeFile = files[activeIdx]

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <Link to="/dashboard" className={styles.logo}>
          codexyy<span className={styles.logoDot}>.dev</span>
        </Link>
        <span className={styles.sep}>/</span>
        <input
          className={styles.repoNameInput}
          value={repoName}
          onChange={e => setRepoName(e.target.value)}
          onBlur={e => saveRepoName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          disabled={!isOwner}
          spellCheck={false}
        />
        <div className={styles.actions}>
          <button
            className={styles.branchChip}
            onClick={() => { setPanelTab('git'); setOutputOpen(true) }}
            title="branch & history"
          >
            ⑂ {branch}
          </button>
          {saveStatus === 'saving' ? (
            <span className={styles.saveStatus}>committing…</span>
          ) : saveStatus === 'saved' ? (
            <span className={`${styles.saveStatus} ${styles.saveOk}`}>✓ committed</span>
          ) : dirtyPaths.length > 0 ? (
            <button
              className={styles.saveUnsaved}
              onClick={() => { setPanelTab('git'); setOutputOpen(true) }}
              title="uncommitted changes — click to commit"
            >
              ● {dirtyPaths.length} uncommitted
            </button>
          ) : null}
          <button className={`${styles.metaBtn} ${starred ? styles.metaBtnOn : ''}`} onClick={toggleStar} title={starred ? 'Unstar' : 'Star'}>
            ★ {starCount > 0 ? starCount : ''}
          </button>
          {!isOwner && (
            <button className={styles.metaBtn} onClick={forkRepo} disabled={forking} title="Fork this repo">
              ⑂ {forkCount > 0 ? forkCount : ''}{forking ? '…' : ''}
            </button>
          )}
          {isOwner && forkCount > 0 && <span className={styles.metaForks}>⑂ {forkCount}</span>}
          <button className={`${styles.runBtn} ${running ? styles.runBtnStop : ''}`} onClick={run}>
            {running
              ? <><span className={styles.stopSquare} />stop</>
              : <><span className={styles.runTriangle} />run</>}
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {/* File tree */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>files</div>
          <div className={styles.fileList}>
            {renderFileTree(files, activeIdx, collapsedDirs, {
              setActive: setActiveIdx,
              toggleDir: (d) => setCollapsedDirs(prev => {
                const next = new Set(prev)
                if (next.has(d)) next.delete(d); else next.add(d)
                return next
              }),
              renamingIdx, renameVal, setRenameVal,
              startRename, commitRename, cancelRename: () => setRenamingIdx(null),
              deleteFile, isOwner,
              styles,
            })}
          </div>
          {isOwner && (
            <button className={styles.addFileBtn} onClick={addFile}>
              + add file
            </button>
          )}
        </aside>

        {/* Editor + terminal */}
        <div className={styles.editorWrap}>
          <div className={styles.editorArea}>
            <Editor
              height="100%"
              language={MONACO_LANG[language] ?? 'plaintext'}
              value={activeFile?.content ?? ''}
              onChange={v => { if (activeFile && isOwner) updateFile(activeIdx, v ?? '') }}
              theme="vs-dark"
              options={{
                fontSize: 14,
                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                padding: { top: 16 },
                tabSize: 2,
                wordWrap: 'off',
                readOnly: !isOwner,
                domReadOnly: !isOwner,
              }}
            />
          </div>

          {/* Terminal */}
          <div className={`${styles.panel} ${outputOpen ? styles.panelOpen : styles.panelClosed}`}>
            <div className={styles.panelBar}>
              <div className={styles.panelTabs}>
                <button
                  className={`${styles.pTab} ${panelTab === 'output' ? styles.pTabActive : ''}`}
                  onClick={() => { setPanelTab('output'); setOutputOpen(true) }}
                >
                  terminal
                  {exitCode !== undefined && (
                    <span className={`${styles.badge} ${hasError ? styles.badgeErr : styles.badgeOk}`}>{exitCode ?? '!'}</span>
                  )}
                </button>
                {isOwner && (
                  <button
                    className={`${styles.pTab} ${panelTab === 'shell' ? styles.pTabActive : ''}`}
                    onClick={() => { setPanelTab('shell'); setOutputOpen(true); if (!shellWsRef.current) openShell() }}
                  >
                    shell
                    {shellOpen && <span className={`${styles.badge} ${styles.badgeOk}`}>●</span>}
                  </button>
                )}
                <button
                  className={`${styles.pTab} ${panelTab === 'git' ? styles.pTabActive : ''}`}
                  onClick={() => { setPanelTab('git'); setOutputOpen(true) }}
                >
                  git
                  {dirtyPaths.length > 0 && (
                    <span className={styles.badge} style={{ background: 'rgba(240,180,41,0.14)', color: '#f0b429' }}>
                      {dirtyPaths.length}
                    </span>
                  )}
                </button>
                {language === 'python' && (
                  <button
                    className={`${styles.pTab} ${panelTab === 'packages' ? styles.pTabActive : ''}`}
                    onClick={() => { setPanelTab('packages'); setOutputOpen(true) }}
                  >
                    packages
                    {packages.length > 0 && <span className={styles.badge} style={{ background: 'rgba(167,139,250,0.12)', color: '#a78bfa' }}>{packages.length}</span>}
                  </button>
                )}
              </div>
              <div className={styles.panelMeta}>
                {running && <span className={styles.runningDot} />}
                <button className={styles.chevron} onClick={() => setOutputOpen(o => !o)}>
                  {outputOpen ? '▾' : '▴'}
                </button>
              </div>
            </div>
            {outputOpen && panelTab === 'output' && (
              <div className={styles.panelBody}>
                <div className={styles.termOut}>
                  {termLines.length === 0 && !running && (
                    <span className={styles.hint}>press run or Ctrl+Enter to execute</span>
                  )}
                  {termLines.map((l, i) => (
                    <span key={i} className={l.err ? styles.termErr : styles.termText}>{l.text}</span>
                  ))}
                  <div ref={termBottomRef} />
                </div>
                {running && (
                  <div className={styles.stdinBar}>
                    <span className={styles.stdinPrompt}>›</span>
                    <input
                      ref={stdinRef}
                      className={styles.stdinInput}
                      value={stdinInput}
                      onChange={e => setStdinInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') sendStdin() }}
                      placeholder="type input and press Enter…"
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>
            )}
            {outputOpen && panelTab === 'git' && (
              <div className={styles.panelBody} style={{ padding: 0 }}>
                <GitPanel
                  repoId={id!}
                  isOwner={isOwner}
                  branch={branch}
                  branches={branches}
                  dirtyPaths={dirtyPaths}
                  committing={committing}
                  onCommit={commitChanges}
                  onSwitchBranch={switchBranch}
                  onBranchesChanged={() => loadRepo(branchRef.current)}
                  onRevert={discardChanges}
                  refreshKey={gitRefresh}
                />
              </div>
            )}
            {outputOpen && panelTab === 'packages' && (
              <div className={styles.panelBody}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', overflowY: 'auto', flex: 1 }}>
                  {packages.length === 0 && <span className={styles.hint}>no packages yet · click scan to detect imports</span>}
                  {packages.map(p => (
                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      <span style={{ color: '#a78bfa', flex: 1 }}>{p}</span>
                      {isOwner && <button onClick={() => removePackage(p)} style={{ background: 'none', border: 'none', color: '#3a3a52', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>×</button>}
                    </div>
                  ))}
                </div>
                {isOwner && (
                  <div className={styles.stdinBar}>
                    <span className={styles.stdinPrompt}>+</span>
                    <input
                      className={styles.stdinInput}
                      value={pkgInput}
                      onChange={e => setPkgInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addPackage() }}
                      placeholder="pip package name (e.g. pygame, numpy)"
                      spellCheck={false}
                    />
                    <button onClick={scanPackages} disabled={scanning} style={{ marginLeft: 8, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, padding: '4px 12px', borderRadius: 4, cursor: 'pointer' }}>
                      {scanning ? 'scanning…' : '⟲ scan imports'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {outputOpen && panelTab === 'shell' && (
              <div className={styles.panelBody}>
                <div className={styles.termOut} ref={shellOutRef}>
                  {!shellOpen && shellLines.length === 0 && (
                    <span className={styles.hint}>connecting to shell…</span>
                  )}
                  <span className={styles.termText} style={{ whiteSpace: 'pre-wrap' }}>{shellLines}</span>
                </div>
                <div className={styles.stdinBar}>
                  <span className={styles.stdinPrompt}>$</span>
                  <input
                    ref={shellInputRef}
                    className={styles.stdinInput}
                    value={shellInput}
                    onChange={e => setShellInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') sendShell() }}
                    placeholder={shellOpen ? "type a command…" : "shell not connected"}
                    disabled={!shellOpen}
                    spellCheck={false}
                  />
                  {shellOpen && (
                    <button
                      onClick={closeShell}
                      style={{ marginLeft: 8, background: 'none', border: '1px solid rgba(255,95,87,0.25)',
                               color: 'rgba(255,95,87,0.7)', fontFamily: 'JetBrains Mono, monospace',
                               fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}
                    >stop</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type TreeOpts = {
  setActive: (i: number) => void
  toggleDir: (d: string) => void
  renamingIdx: number | null
  renameVal: string
  setRenameVal: (v: string) => void
  startRename: (i: number) => void
  commitRename: (i: number) => void
  cancelRename: () => void
  deleteFile: (i: number) => void
  isOwner: boolean
  styles: Record<string, string>
}

function renderFileTree(
  files: { path: string; content: string }[],
  activeIdx: number,
  collapsed: Set<string>,
  o: TreeOpts,
) {
  // Group by directory
  type Node = { name: string; dir: string; children: Map<string, Node>; idx?: number }
  const root: Node = { name: '', dir: '', children: new Map() }
  files.forEach((f, idx) => {
    const parts = f.path.split('/')
    let node = root
    let curDir = ''
    parts.forEach((p, i) => {
      if (i === parts.length - 1) {
        node.children.set(p, { name: p, dir: curDir, children: new Map(), idx })
      } else {
        curDir = curDir ? `${curDir}/${p}` : p
        if (!node.children.has(p)) node.children.set(p, { name: p, dir: curDir, children: new Map() })
        node = node.children.get(p)!
      }
    })
  })

  const out: any[] = []
  const walk = (node: Node, depth: number) => {
    const entries = Array.from(node.children.values()).sort((a, b) => {
      const aIsDir = a.idx === undefined, bIsDir = b.idx === undefined
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const child of entries) {
      const isDir = child.idx === undefined
      const dirPath = child.dir
      if (isDir) {
        const isCollapsed = collapsed.has(dirPath)
        out.push(
          <div
            key={`d:${dirPath}`}
            className={o.styles.fileItem}
            style={{ paddingLeft: 12 + depth * 12, color: '#7878a0' }}
            onClick={() => o.toggleDir(dirPath)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') o.toggleDir(dirPath) }}
            role="button"
            tabIndex={0}
          >
            <span style={{ marginRight: 4, fontSize: 9 }}>{isCollapsed ? '▸' : '▾'}</span>
            <span className={o.styles.fileName}>{child.name}/</span>
          </div>
        )
        if (!isCollapsed) walk(child, depth + 1)
      } else {
        const i = child.idx!
        out.push(
          <div
            key={`f:${i}`}
            className={`${o.styles.fileItem} ${i === activeIdx ? o.styles.fileItemActive : ''}`}
            style={{ paddingLeft: 12 + depth * 12 }}
            onClick={() => { if (o.renamingIdx !== i) o.setActive(i) }}
            onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && o.renamingIdx !== i) o.setActive(i) }}
            onDoubleClick={() => o.isOwner && o.startRename(i)}
            role="button"
            tabIndex={0}
          >
            {o.renamingIdx === i ? (
              <input
                className={o.styles.renameInput}
                value={o.renameVal}
                autoFocus
                onChange={e => o.setRenameVal(e.target.value)}
                onBlur={() => o.commitRename(i)}
                onKeyDown={e => {
                  if (e.key === 'Enter') o.commitRename(i)
                  if (e.key === 'Escape') o.cancelRename()
                }}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className={o.styles.fileName}>{child.name}</span>
            )}
            {o.isOwner && o.renamingIdx !== i && (
              <button
                type="button"
                className={o.styles.fileDelete}
                onClick={e => { e.stopPropagation(); o.deleteFile(i) }}
                aria-label={`Delete ${child.name}`}
              >×</button>
            )}
          </div>
        )
      }
    }
  }
  walk(root, 0)
  return out
}
