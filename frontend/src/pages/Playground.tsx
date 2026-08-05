import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useSearchParams, Link, useNavigate } from '../router'
import Editor from '@monaco-editor/react'
import PlayLoader from '../components/PlayLoader'
import styles from './Playground.module.css'

const LANGUAGES = [
  { label: 'Python',     piston: 'python',     monaco: 'python',     ext: 'main.py',    hasPkg: true,  default: 'def fib(n):\n    if n <= 1: return n\n    return fib(n-1) + fib(n-2)\n\nfor i in range(8):\n    print(f"fib({i}) = {fib(i)}")\n' },
  { label: 'JavaScript', piston: 'javascript', monaco: 'javascript', ext: 'main.js',    hasPkg: true,  default: 'function fib(n) {\n  if (n <= 1) return n\n  return fib(n-1) + fib(n-2)\n}\nfor (let i = 0; i < 8; i++) console.log(`fib(${i}) = ${fib(i)}`)\n' },
  { label: 'TypeScript', piston: 'typescript', monaco: 'typescript', ext: 'main.ts',    hasPkg: true,  default: 'function fib(n: number): number {\n  if (n <= 1) return n\n  return fib(n-1) + fib(n-2)\n}\nfor (let i = 0; i < 8; i++) console.log(`fib(${i}) = ${fib(i)}`)\n' },
  { label: 'Go',         piston: 'go',         monaco: 'go',         ext: 'main.go',    hasPkg: false, default: 'package main\n\nimport "fmt"\n\nfunc fib(n int) int {\n\tif n <= 1 { return n }\n\treturn fib(n-1) + fib(n-2)\n}\n\nfunc main() {\n\tfor i := 0; i < 8; i++ {\n\t\tfmt.Printf("fib(%d) = %d\\n", i, fib(i))\n\t}\n}\n' },
  { label: 'Rust',       piston: 'rust',       monaco: 'rust',       ext: 'main.rs',    hasPkg: false, default: 'fn fib(n: u64) -> u64 {\n    if n <= 1 { return n; }\n    fib(n-1) + fib(n-2)\n}\nfn main() {\n    for i in 0..8 { println!("fib({}) = {}", i, fib(i)); }\n}\n' },
  { label: 'C',          piston: 'c',          monaco: 'c',          ext: 'main.c',     hasPkg: false, default: '#include <stdio.h>\nint fib(int n) { return n <= 1 ? n : fib(n-1)+fib(n-2); }\nint main() {\n    for (int i = 0; i < 8; i++) printf("fib(%d) = %d\\n", i, fib(i));\n}\n' },
  { label: 'C++',        piston: 'c++',        monaco: 'cpp',        ext: 'main.cpp',   hasPkg: false, default: '#include <iostream>\nint fib(int n) { return n <= 1 ? n : fib(n-1)+fib(n-2); }\nint main() {\n    for (int i = 0; i < 8; i++) std::cout << "fib(" << i << ") = " << fib(i) << "\\n";\n}\n' },
  { label: 'Java',       piston: 'java',       monaco: 'java',       ext: 'Main.java',  hasPkg: false, default: 'public class Main {\n    static int fib(int n) { return n <= 1 ? n : fib(n-1)+fib(n-2); }\n    public static void main(String[] args) {\n        for (int i = 0; i < 8; i++) System.out.println("fib("+i+") = "+fib(i));\n    }\n}\n' },
  { label: 'Ruby',       piston: 'ruby',       monaco: 'ruby',       ext: 'main.rb',    hasPkg: true,  default: 'def fib(n) = n <= 1 ? n : fib(n-1) + fib(n-2)\n8.times { |i| puts "fib(#{i}) = #{fib(i)}" }\n' },
  { label: 'PHP',        piston: 'php',        monaco: 'php',        ext: 'main.php',   hasPkg: false, default: '<?php\nfunction fib($n) { return $n <= 1 ? $n : fib($n-1)+fib($n-2); }\nfor ($i = 0; $i < 8; $i++) echo "fib($i) = ".fib($i)."\\n";\n' },
  { label: 'Swift',      piston: 'swift',      monaco: 'swift',      ext: 'main.swift', hasPkg: false, default: 'func fib(_ n: Int) -> Int { n <= 1 ? n : fib(n-1)+fib(n-2) }\nfor i in 0..<8 { print("fib(\\(i)) = \\(fib(i))") }\n' },
  { label: 'Kotlin',     piston: 'kotlin',     monaco: 'kotlin',     ext: 'main.kt',    hasPkg: false, default: 'fun fib(n: Int): Int = if (n <= 1) n else fib(n-1) + fib(n-2)\nfun main() { for (i in 0 until 8) println("fib($i) = ${fib(i)}") }\n' },
  { label: 'Bash',       piston: 'bash',       monaco: 'shell',      ext: 'main.sh',    hasPkg: false, default: 'fib() { [ "$1" -le 1 ] && echo "$1" || echo $(( $(fib $(($1-1))) + $(fib $(($1-2))) )); }\nfor i in $(seq 0 7); do echo "fib($i) = $(fib $i)"; done\n' },
  { label: 'Lua',        piston: 'lua',        monaco: 'lua',        ext: 'main.lua',   hasPkg: false, default: 'function fib(n) return n <= 1 and n or fib(n-1)+fib(n-2) end\nfor i = 0, 7 do print("fib("..i..") = "..fib(i)) end\n' },
  { label: 'R',          piston: 'r',          monaco: 'r',          ext: 'main.r',     hasPkg: false, default: 'fib <- function(n) if (n <= 1) n else fib(n-1) + fib(n-2)\nfor (i in 0:7) cat(sprintf("fib(%d) = %d\\n", i, fib(i)))\n' },
]

const DEFAULT = LANGUAGES[0]
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)

type TermLine = { text: string; err?: boolean }
type Tab = 'output' | 'packages'

type SnippetMeta = {
  views: number
  star_count: number
  fork_count: number
  starred: boolean
  author_name?: string
  author_avatar?: string
  title?: string
  created_at?: number
}

function timeAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

export default function Playground() {
  const { id } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const snippetId = id || searchParams.get('id')

  const [lang, setLang] = useState(DEFAULT)
  const [code, setCode] = useState(DEFAULT.default)
  const [packages, setPackages] = useState<string[]>([])
  const [pkgInput, setPkgInput] = useState('')
  const [installingPkg, setInstallingPkg] = useState('')

  const [running, setRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined)
  const [termLines, setTermLines] = useState<TermLine[]>([])
  const [stdinInput, setStdinInput] = useState('')
  const [tab, setTab] = useState<Tab>('output')
  const [outputOpen, setOutputOpen] = useState(true)

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [isOwner, setIsOwner] = useState(false)

  const [loaderDone, setLoaderDone] = useState(false)

  // GitHub-like meta — null = loading, undefined = no snippet yet
  const [meta, setMeta] = useState<SnippetMeta | null | undefined>(undefined)
  const [metaLoading, setMetaLoading] = useState(false)
  const [forking, setForking] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const termBottomRef = useRef<HTMLDivElement>(null)
  const stdinInputRef = useRef<HTMLInputElement>(null)
  const snippetIdRef = useRef<string | undefined>(snippetId ?? undefined) as React.MutableRefObject<string | undefined>
  const autoSaveTimer = useRef(null) as React.MutableRefObject<ReturnType<typeof setTimeout> | null>

  // Page title
  useEffect(() => {
    if (snippetId && meta?.title) {
      document.title = `${meta.title} — codexyy playground`
    } else if (snippetId) {
      document.title = `snippet/${snippetId} — codexyy playground`
    } else {
      document.title = 'codexyy playground — write and run code'
    }
    return () => { document.title = 'codexyy.dev — Run code in your browser' }
  }, [snippetId, meta?.title])

  useEffect(() => { snippetIdRef.current = snippetId ?? undefined }, [snippetId])

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => setAuthed(r.ok))
      .catch(() => setAuthed(false))
  }, [])

  useEffect(() => {
    if (!snippetId) { setMeta(undefined); return }
    setMetaLoading(true)
    setMeta(null)
    fetch(`/api/paste/${snippetId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.content) return
        setCode(d.content)
        // Only the actual owner (matched server-side) can edit
        setIsOwner(d.is_owner === true)
        if (d.packages) setPackages(d.packages)
        const found = LANGUAGES.find(l => l.piston === d.language || l.monaco === d.language)
        if (found) setLang(found)
        setMeta({
          views: d.views ?? 0,
          star_count: d.star_count ?? 0,
          fork_count: d.fork_count ?? 0,
          starred: d.starred ?? false,
          author_name: d.author_name,
          author_avatar: d.author_avatar,
          title: d.title,
          created_at: d.created_at,
        })
      })
      .catch(() => {})
      .finally(() => setMetaLoading(false))
  }, [snippetId])

  // Auto-save: only for authenticated owners (or new snippets by authed users)
  useEffect(() => {
    if (authed !== true) return
    if (snippetId && !isOwner) return  // viewing someone else's snippet — no auto-save
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      const currentId = snippetIdRef.current
      setSaveStatus('saving')
      try {
        if (currentId && isOwner) {
          await fetch(`/api/paste/${currentId}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: code, language: lang.piston }),
          })
        } else if (!currentId) {
          const res = await fetch('/api/paste', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: `${lang.label} snippet`, content: code, language: lang.piston, expires_hours: 0, private: false }),
          })
          const d = await res.json()
          if (d.id) {
            snippetIdRef.current = d.id
            window.history.replaceState({}, '', `/play/${d.id}`)
            setIsOwner(true)
          }
        }
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch {
        setSaveStatus('idle')
      }
    }, 1500)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [code, lang, authed, isOwner, snippetId])

  useEffect(() => {
    termBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [termLines])

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
    setTab('output')
    setRunning(true)

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/run`)
    wsRef.current = ws

    ws.onopen = () => ws.send(JSON.stringify({ language: lang.piston, code, packages }))
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'stdout') setTermLines(p => [...p, { text: msg.data }])
      else if (msg.type === 'stderr') setTermLines(p => [...p, { text: msg.data, err: true }])
      else if (msg.type === 'started') stdinInputRef.current?.focus()
      else if (msg.type === 'exit') { setExitCode(msg.code); setRunning(false); wsRef.current = null }
      else if (msg.type === 'error') { setTermLines(p => [...p, { text: msg.data, err: true }]); setRunning(false); wsRef.current = null }
    }
    ws.onclose = () => { setRunning(false); wsRef.current = null }
  }, [running, lang, code, packages])

  const sendStdin = () => {
    const data = stdinInput + '\n'
    setStdinInput('')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stdin', data }))
      setTermLines(p => [...p, { text: data }])
    }
  }

  const share = async () => {
    if (!authed) {
      window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`
      return
    }
    if (saving) return
    setSaving(true)
    try {
      const currentId = snippetIdRef.current
      if (!currentId) {
        const res = await fetch('/api/paste', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: `${lang.label} snippet`, content: code, language: lang.piston, expires_hours: 0, private: false }),
        })
        const d = await res.json()
        if (d.id) {
          snippetIdRef.current = d.id
          window.history.replaceState({}, '', `/play/${d.id}`)
          setIsOwner(true)
        }
      }
      await navigator.clipboard.writeText(window.location.href).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {}
    setSaving(false)
  }

  const toggleStar = async () => {
    if (!authed || !snippetIdRef.current) {
      if (!authed) window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`
      return
    }
    const prev = meta
    // Optimistic update
    setMeta(m => m ? {
      ...m,
      starred: !m.starred,
      star_count: m.starred ? m.star_count - 1 : m.star_count + 1,
    } : m)
    try {
      const r = await fetch(`/api/paste/${snippetIdRef.current}/star`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      setMeta(m => m ? { ...m, starred: d.starred } : m)
    } catch {
      setMeta(prev)
    }
  }

  const forkSnippet = async () => {
    if (!authed) {
      window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`
      return
    }
    if (!snippetIdRef.current || forking) return
    setForking(true)
    try {
      const r = await fetch(`/api/paste/${snippetIdRef.current}/fork`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (d.id) {
        setMeta(m => m ? { ...m, fork_count: m.fork_count + 1 } : m)
        navigate(`/play/${d.id}`)
      }
    } catch {}
    setForking(false)
  }

  const addPackage = async () => {
    const pkg = pkgInput.trim()
    if (!pkg || packages.includes(pkg)) { setPkgInput(''); return }
    if (!lang.hasPkg) return
    setInstallingPkg(pkg)
    try {
      const res = await fetch('/api/packages/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang.piston, package: pkg }),
      })
      if (res.ok) {
        setPackages(prev => [...prev, pkg])
        setPkgInput('')
      } else {
        const d = await res.json()
        setTermLines(p => [...p, { text: `Failed to install ${pkg}: ${d.detail}`, err: true }])
        setOutputOpen(true); setTab('output')
      }
    } catch {
      setTermLines(p => [...p, { text: `Network error installing ${pkg}`, err: true }])
    }
    setInstallingPkg('')
  }

  const changeLang = (l: typeof LANGUAGES[0]) => {
    setLang(l); setCode(l.default); setPackages([]); setTermLines([]); setExitCode(undefined)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [run])

  const hasError = exitCode !== undefined && exitCode !== null && exitCode !== 0
  const readOnly = !!snippetId && !isOwner

  if (!loaderDone) return <PlayLoader onDone={() => setLoaderDone(true)} />

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <Link to="/" className={styles.logo}>
          <span>codexyy</span><span className={styles.logoDot}>.dev</span>
        </Link>

        <div className={styles.langWrap}>
          <select
            className={styles.langSelect}
            value={lang.piston}
            onChange={e => changeLang(LANGUAGES.find(l => l.piston === e.target.value) ?? DEFAULT)}
            disabled={readOnly}
          >
            {LANGUAGES.map(l => <option key={l.piston} value={l.piston}>{l.label}</option>)}
          </select>
          <span className={styles.ext}>{lang.ext}</span>
          {readOnly && <span className={styles.readonlyBadge}>read-only</span>}
        </div>

        <div className={styles.actions}>
          {saveStatus === 'saving' && <span className={styles.saveStatus}>saving…</span>}
          {saveStatus === 'saved'  && <span className={`${styles.saveStatus} ${styles.saveOk}`}>saved</span>}
          <button className={styles.shareBtn} onClick={share} disabled={saving}>
            {copied ? '✓ copied' : saving ? '…' : authed === false ? 'sign in to share' : 'copy link'}
          </button>
          <button className={`${styles.runBtn} ${running ? styles.runBtnStop : ''}`} onClick={run}>
            {running
              ? <><span className={styles.stopSquare} />stop</>
              : <><span className={styles.runTriangle} />run</>
            }
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.editorWrap}>
          <Editor
            height="100%"
            language={lang.monaco}
            value={code}
            onChange={v => { if (!readOnly) setCode(v ?? '') }}
            theme="vs-dark"
            options={{
              fontSize: 14,
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              renderWhitespace: 'none',
              padding: { top: 16 },
              tabSize: 2,
              wordWrap: 'off',
              readOnly,
              domReadOnly: readOnly,
            }}
          />
        </div>

        <div className={styles.rightCol}>
          {/* GitHub-like meta sidebar — only shown for saved snippets */}
          {snippetId && (
            <div className={styles.metaPanel}>
              {metaLoading || meta === null ? (
                <div className={styles.metaSkeleton}>
                  <div className={`${styles.skeletonLine} ${styles.skWide}`} />
                  <div className={`${styles.skeletonLine} ${styles.skMid}`} />
                  <div className={styles.skeletonRow}>
                    <div className={`${styles.skeletonChip}`} />
                    <div className={`${styles.skeletonChip}`} />
                    <div className={`${styles.skeletonChip}`} />
                  </div>
                </div>
              ) : meta ? (
                <>
                  {/* Author */}
                  <div className={styles.metaAuthor}>
                    {meta.author_avatar
                      ? <img src={meta.author_avatar} className={styles.avatar} alt="" />
                      : <div className={styles.avatarAnon}>{meta.author_name?.[0]?.toUpperCase() ?? '?'}</div>
                    }
                    <div className={styles.metaAuthorInfo}>
                      <span className={styles.metaAuthorName}>{meta.author_name ?? 'anonymous'}</span>
                      {meta.created_at && (
                        <span className={styles.metaAge}>{timeAgo(meta.created_at)}</span>
                      )}
                    </div>
                  </div>

                  <div className={styles.metaDivider} />

                  {/* Stats row */}
                  <div className={styles.metaStats}>
                    <div className={styles.metaStat}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>
                      </svg>
                      <span>{meta.star_count}</span>
                    </div>
                    <div className={styles.metaStat}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/>
                      </svg>
                      <span>{meta.fork_count}</span>
                    </div>
                    <div className={styles.metaStat}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.824-.742 3.955-1.715 1.125-.967 1.955-2.095 2.366-2.717a.12.12 0 0 0 0-.136c-.411-.622-1.241-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.824.742-3.955 1.715-1.125.967-1.955 2.095-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"/>
                      </svg>
                      <span>{meta.views}</span>
                    </div>
                  </div>

                  <div className={styles.metaDivider} />

                  {/* Actions */}
                  <div className={styles.metaActions}>
                    <button
                      className={`${styles.metaBtn} ${meta.starred ? styles.metaBtnStarred : ''}`}
                      onClick={toggleStar}
                      title={meta.starred ? 'Unstar' : 'Star this snippet'}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill={meta.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={meta.starred ? 0 : 1.5}>
                        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>
                      </svg>
                      {meta.starred ? 'Starred' : 'Star'}
                    </button>
                    <button
                      className={styles.metaBtn}
                      onClick={forkSnippet}
                      disabled={forking}
                      title="Fork — copy to your account and edit"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/>
                      </svg>
                      {forking ? 'Forking…' : 'Fork'}
                    </button>
                  </div>

                  {/* Language badge */}
                  <div className={styles.metaDivider} />
                  <div className={styles.metaLang}>
                    <span className={styles.metaLangDot} style={{ background: langColor(lang.piston) }} />
                    {lang.label}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* Terminal / packages panel */}
          <div className={`${styles.panel} ${outputOpen ? styles.panelOpen : styles.panelClosed} ${snippetId ? styles.panelWithMeta : ''}`}>
            <div className={styles.panelBar}>
              <div className={styles.panelTabs}>
                <button
                  className={`${styles.pTab} ${tab === 'output' ? styles.pTabActive : ''}`}
                  onClick={() => { setTab('output'); setOutputOpen(true) }}
                >
                  terminal
                  {exitCode !== undefined && (
                    <span className={`${styles.badge} ${hasError ? styles.badgeErr : styles.badgeOk}`}>
                      {exitCode ?? '!'}
                    </span>
                  )}
                </button>
                {lang.hasPkg && (
                  <button
                    className={`${styles.pTab} ${tab === 'packages' ? styles.pTabActive : ''}`}
                    onClick={() => { setTab('packages'); setOutputOpen(true) }}
                  >
                    packages
                    {packages.length > 0 && <span className={styles.pkgCount}>{packages.length}</span>}
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

            {outputOpen && (
              <div className={styles.panelBody}>
                {tab === 'output' ? (
                  <>
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
                          ref={stdinInputRef}
                          className={styles.stdinInput}
                          value={stdinInput}
                          onChange={e => setStdinInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') sendStdin() }}
                          placeholder="type input and press Enter…"
                          spellCheck={false}
                          autoComplete="off"
                          enterKeyHint="send"
                        />
                        {isIOS && (
                          <button className={styles.stdinEnterBtn} onClick={sendStdin}>↵</button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className={styles.pkgPanel}>
                    <div className={styles.pkgList}>
                      {packages.length === 0 && (
                        <span className={styles.hint}>no packages added yet</span>
                      )}
                      {packages.map(p => (
                        <div key={p} className={styles.pkgRow}>
                          <span className={styles.pkgName}>{p}</span>
                          <button
                            className={styles.pkgRemove}
                            onClick={() => setPackages(prev => prev.filter(x => x !== p))}
                          >×</button>
                        </div>
                      ))}
                    </div>
                    <div className={styles.pkgAdd}>
                      <span className={styles.stdinPrompt}>+</span>
                      <input
                        className={styles.stdinInput}
                        value={pkgInput}
                        onChange={e => setPkgInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addPackage() }}
                        placeholder={`package name (e.g. ${lang.piston === 'python' ? 'numpy' : lang.piston === 'ruby' ? 'httparty' : 'axios'})`}
                        spellCheck={false}
                        disabled={!!installingPkg}
                      />
                      <button
                        className={styles.pkgInstallBtn}
                        onClick={addPackage}
                        disabled={!!installingPkg || !pkgInput.trim()}
                      >
                        {installingPkg ? 'installing…' : 'install'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function langColor(piston: string) {
  const map: Record<string, string> = {
    python: '#3572A5', javascript: '#f1e05a', typescript: '#2b7489',
    go: '#00ADD8', rust: '#dea584', c: '#555555', 'c++': '#f34b7d',
    java: '#b07219', ruby: '#701516', php: '#4F5D95', swift: '#ffac45',
    kotlin: '#A97BFF', bash: '#89e051', lua: '#000080', r: '#198CE7',
  }
  return map[piston] ?? '#8b8b8b'
}
