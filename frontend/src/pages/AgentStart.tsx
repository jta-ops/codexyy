import { useEffect, useMemo, useState } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './WorkspaceTools.module.css'

type Repo = { id: string; name: string; description?: string; language?: string; private?: number }

function quoteShell(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export default function AgentStart() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [selected, setSelected] = useState('')
  const [task, setTask] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetch('/auth/me', { credentials: 'include', signal: controller.signal }),
      fetch('/api/repos/mine', { credentials: 'include', signal: controller.signal }),
    ]).then(async ([me, result]) => {
      if (!me.ok) { setState('signed-out'); return }
      if (!result.ok) throw new Error('Repository list unavailable')
      const data = await result.json() as Repo[]
      setRepos(data)
      setSelected(data[0]?.id ?? '')
      setState('ready')
    }).catch(error => {
      if (error.name !== 'AbortError') setState('error')
    })
    return () => controller.abort()
  }, [])

  const selectedRepo = repos.find(repo => repo.id === selected)
  const command = useMemo(() => selectedRepo && task.trim()
    ? `cxy task start ${quoteShell(selectedRepo.id)} ${quoteShell(task.trim())} --output json`
    : '', [selectedRepo, task])

  async function copyCommand() {
    if (!command) return
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return <div className={styles.page}>
    <Nav />
    <main className={styles.main}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>Isolated agent launch</span>
        <h1>Pick a repository.<br/><em>Start clean.</em></h1>
        <p>Every task gets its own branch and workspace, so concurrent agents never edit the same working tree.</p>
      </header>

      {state === 'loading' && <div className={styles.notice} role="status">Loading your repositories…</div>}
      {state === 'signed-out' && <section className={styles.notice}>
        <h2>Sign in to choose a repository</h2><p>Your repository list is private.</p>
        <a className={styles.primary} href="/auth/login?next=/agent/start">Choose a sign-in option</a>
      </section>}
      {state === 'error' && <div className={styles.error} role="alert">Repositories are temporarily unavailable. Try again shortly.</div>}
      {state === 'ready' && repos.length === 0 && <section className={styles.notice}>
        <h2>No repositories yet</h2><p>Create or import one from the dashboard first.</p><a className={styles.primary} href="/dashboard">Open dashboard</a>
      </section>}
      {state === 'ready' && repos.length > 0 && <div className={styles.launchGrid}>
        <section className={styles.panel} aria-labelledby="repo-picker-title">
          <div className={styles.panelHead}><span>01</span><h2 id="repo-picker-title">Repository</h2></div>
          <fieldset className={styles.repoGrid}>
            <legend className={styles.srOnly}>Choose a repository</legend>
            {repos.map(repo => <label className={`${styles.repoOption} ${selected === repo.id ? styles.selected : ''}`} key={repo.id}>
              <input type="radio" name="repository" value={repo.id} checked={selected === repo.id} onChange={() => setSelected(repo.id)} />
              <span><strong>{repo.name}</strong><small>{repo.description || `${repo.language || 'Code'} repository`}</small></span>
              <b>{repo.private ? 'Private' : 'Public'}</b>
            </label>)}
          </fieldset>
        </section>
        <section className={styles.panel} aria-labelledby="task-title">
          <div className={styles.panelHead}><span>02</span><h2 id="task-title">Task</h2></div>
          <label className={styles.field}>
            <span>What should the agent work on?</span>
            <input value={task} onChange={event => setTask(event.target.value)} maxLength={120} placeholder="Fix checkout error handling" autoComplete="off" />
          </label>
          <div className={styles.commandBox} aria-live="polite">
            <code>{command || 'Choose a repository and describe the task.'}</code>
            <button type="button" onClick={copyCommand} disabled={!command}>{copied ? 'Copied' : 'Copy launch command'}</button>
          </div>
          <p className={styles.hint}>Run the command in a terminal with cxy installed. It creates the branch, downloads that branch into a dedicated workspace, and returns machine-readable launch details.</p>
        </section>
      </div>}
    </main>
    <Footer />
  </div>
}
