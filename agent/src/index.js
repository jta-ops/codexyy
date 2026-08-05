import * as readline from 'readline'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { loadConfig, saveConfig } from './config.js'
import { Agent, PROVIDER_MODELS, fetchHostedModels } from './ai.js'
import { runSetup } from './setup.js'
import { login, loadAuth, clearAuth } from './auth.js'
import { saveSession, loadSession, clearSession, formatTimeAgo } from './session.js'
import { toolHandlers } from './tools.js'
import renderer from './renderer.js'
import { startOnlineServer, createBroadcaster } from './server.js'

// ── Never crash ───────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  renderer.printError(`Uncaught: ${err.message}`)
})
process.on('unhandledRejection', (reason) => {
  renderer.printError(`Unhandled: ${reason?.message || reason}`)
})

// ── Project context ───────────────────────────────────────────────────────────
function loadProjectContext() {
  const candidates = [
    join(process.cwd(), '.codexyy', 'context.md'),
    join(process.cwd(), 'CLAUDE.md'),
    join(process.cwd(), '.cursorrules'),
    join(process.cwd(), '.codexyy.md'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      try { return readFileSync(p, 'utf8').trim() } catch {}
    }
  }
  return null
}

export async function run(argv) {
  const args = argv.slice(2)
  const onlineMode = args.includes('--online') || args.includes('-o')
  const resetFlag  = args.includes('--setup')
  const initialPrompt = args.filter(a => !a.startsWith('-')).join(' ')

  // ── Auth check ────────────────────────────────────────────────
  const logoutFlag = args.includes('--logout')
  if (logoutFlag) {
    clearAuth()
    console.log('  Logged out.\n')
    process.exit(0)
  }

  let auth = loadAuth()
  if (!auth?.token) {
    auth = { token: await login() }
  } else {
    try {
      const res = await fetch('https://codexyy.dev/auth/me', {
        headers: { Authorization: `Bearer ${auth.token}` }
      })
      if (!res.ok) {
        console.log('  Session expired. Please sign in again.\n')
        auth = { token: await login() }
      } else {
        auth.user = await res.json()
      }
    } catch {
      // offline — allow cached token
    }
  }

  // ── Provider setup ────────────────────────────────────────────
  let cfg = loadConfig()
  if (!cfg.provider || resetFlag) cfg = await runSetup()

  const projectContext = loadProjectContext()
  const agent = new Agent(cfg, projectContext)

  // ── Session restore ───────────────────────────────────────────
  const session = loadSession()
  if (session?.history?.length) {
    const msgCount = session.history.filter(m => m.role === 'user').length
    const timeStr = formatTimeAgo(session.savedAt)
    const ans = await askOnce(`  Resume last session? (${msgCount} messages, ${timeStr}) [y/N] `)
    if (ans.toLowerCase() === 'y') {
      agent.history = session.history
      console.log('  Resumed last session.\n')
    } else {
      console.log()
    }
  }

  // ── Online mode ───────────────────────────────────────────────
  if (onlineMode) {
    const onChat = async (text) => {
      try { await agent.chat(text) } catch(e) { renderer.printError(e.message) }
    }
    const { broadcast, port } = await startOnlineServer(process.cwd(), 0, onChat)
    agent.setBroadcaster(createBroadcaster(broadcast))
    const url = `http://localhost:${port}`
    console.log(`  --online: ${url}`)
    try {
      execSync(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} ${url}`, { stdio: 'ignore' })
    } catch {}
  }

  renderer.printBanner()

  const providerLabel = cfg.provider === 'codexyy' ? 'codexyy hosted' :
                        cfg.provider === 'ollama'   ? 'Ollama' : cfg.provider
  const userName = auth?.user?.name || auth?.user?.email || ''
  if (userName) renderer.printInfo(`  Signed in as ${userName}`)
  if (projectContext) renderer.printInfo(`  Context loaded from project file`)
  renderer.printInfo(`  Provider: ${providerLabel}  Model: ${agent.model}`)
  renderer.printInfo(`  CWD: ${process.cwd()}\n`)

  // ── Readline REPL ─────────────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
    completer: (line) => {
      if (!line.startsWith('/')) return [[], line]
      const CMDS = ['help','plan','undo','git','context','clear','model',
        'provider','setup','cost','session','prompt','whoami','logout','exit']
      const typed = line.slice(1)
      const hits = CMDS.filter(c => c.startsWith(typed)).map(c => '/' + c)
      return [hits.length ? hits : [], line]
    }
  })

  rl.on('SIGINT', () => {
    renderer.printInfo('  (use Ctrl+D or /exit to quit, /help for commands)')
    rl.prompt()
  })

  rl.on('close', () => {
    if (agent.history.length) saveSession(agent.history, { provider: cfg.provider, model: cfg.model })
    process.stdout.write('\n  Goodbye.\n\n')
    process.exit(0)
  })

  const prompt = () => {
    process.stdout.write('\n  You > ')
  }

  rl.on('line', async (line) => {
    const input = line.trim()
    if (!input) { prompt(); return }
    renderer.printUser(input)
    await handleInput(input, agent, cfg, rl)
    prompt()
  })

  if (initialPrompt) {
    renderer.printUser(initialPrompt)
    await handleInput(initialPrompt, agent, cfg, rl)
  }

  prompt()
}

async function handleInput(input, agent, cfg, rl) {
  if (!input.startsWith('/')) {
    try {
      await agent.chat(input)
      saveSession(agent.history, { provider: cfg.provider, model: cfg.model })
    } catch (e) {
      if (e?.status === 401) renderer.printError('Invalid API key or token. Run /setup to reconfigure.')
      else if (e?.status === 429) renderer.printError('Rate limited. Please wait a moment.')
      else renderer.printError(e.message || String(e))
    }
    return
  }

  const [cmd, ...rest] = input.slice(1).split(' ')
  switch (cmd.toLowerCase()) {

    case 'help':
      renderer.printHelp()
      break

    case 'exit':
    case 'quit':
      rl.close()
      break

    case 'clear':
      agent.clearHistory()
      clearSession()
      renderer.printInfo('  History and session cleared.')
      break

    case 'cost':
      renderer.printCost(agent.usage)
      break

    case 'undo': {
      const file = rest[0]
      if (!file) { renderer.printInfo('  Usage: /undo <filepath>'); break }
      const result = await toolHandlers.restore_file({ path: file })
      if (result.error) renderer.printError(result.error)
      else renderer.printInfo(`  Restored ${result.restored}`)
      break
    }

    case 'plan': {
      const task = rest.join(' ').trim()
      if (!task) { renderer.printInfo('  Usage: /plan <task description>'); break }
      const prompt = `Before writing any code, make a detailed plan for this task. List:\n1. Which files to read/modify\n2. The approach and key decisions\n3. Any edge cases or risks\n\nThen ask me to confirm before proceeding.\n\nTask: ${task}`
      try {
        await agent.chat(prompt)
        saveSession(agent.history, { provider: cfg.provider, model: cfg.model })
      } catch (e) { renderer.printError(e.message) }
      break
    }

    case 'git': {
      const sub = rest[0] || 'status'
      try {
        let result
        if (sub === 'status') result = await toolHandlers.git_status({})
        else if (sub === 'diff') result = await toolHandlers.git_diff({ staged: rest[1] === '--staged' })
        else if (sub === 'log') result = await toolHandlers.git_log({ count: parseInt(rest[1]) || 10 })
        else if (sub === 'commit') {
          const msg = rest.slice(1).join(' ')
          if (!msg) { renderer.printInfo('  Usage: /git commit <message>'); break }
          result = await toolHandlers.git_commit({ message: msg })
        } else {
          renderer.printInfo('  Usage: /git [status|diff|log|commit <msg>]'); break
        }
        if (result.error) renderer.printError(result.error)
        else renderer.printInfo('\n' + (result.status || result.diff || result.log || result.output || 'done') + '\n')
      } catch (e) { renderer.printError(e.message) }
      break
    }

    case 'session': {
      const sub = rest[0]
      if (sub === 'clear') {
        agent.clearHistory()
        clearSession()
        renderer.printInfo('  Session cleared.')
      } else {
        const s = loadSession()
        if (!s?.history?.length) {
          renderer.printInfo('  No saved session.')
        } else {
          const msgCount = s.history.filter(m => m.role === 'user').length
          renderer.printInfo(`  Last session: ${msgCount} messages, saved ${formatTimeAgo(s.savedAt)}`)
          renderer.printInfo(`  Current: ${agent.history.filter(m => m.role === 'user').length} messages in history`)
        }
      }
      break
    }

    case 'context': {
      const ctx = loadProjectContext()
      if (!ctx) renderer.printInfo('  No project context file found (.codexyy/context.md, CLAUDE.md, .cursorrules)')
      else renderer.printInfo(`  Project context loaded (${ctx.length} chars):\n\n${ctx.slice(0, 500)}${ctx.length > 500 ? '...' : ''}`)
      break
    }

    case 'prompt': {
      const a = loadAuth()
      if (!a?.token) { renderer.printError('Not logged in.'); break }
      const promptArg = rest.join(' ').trim()
      if (!promptArg) {
        try {
          const sr = await fetch('https://codexyy.dev/api/user/settings', {
            headers: { Authorization: `Bearer ${a.token}` }
          })
          if (!sr.ok) throw new Error(sr.statusText)
          const s = await sr.json()
          if (s.custom_prompt) renderer.printInfo(`  Current prompt:\n  ${s.custom_prompt}`)
          else renderer.printInfo('  No custom prompt set. Usage: /prompt <your instructions>')
        } catch (e) { renderer.printError(e.message) }
      } else {
        agent.setCustomPrompt(promptArg)
        renderer.printInfo('  Custom prompt applied to this session.')
      }
      break
    }

    case 'setup':
    case 'provider': {
      rl.pause()
      try {
        const newCfg = await runSetup()
        Object.assign(cfg, newCfg)
        agent.cfg = cfg
        agent.provider = cfg.provider
        agent.model = cfg.model
        agent._buildClient()
        agent.clearHistory()
        clearSession()
        renderer.printInfo(`  Switched to ${cfg.provider} / ${cfg.model}\n`)
      } catch(e) {
        renderer.printError(e.message)
      } finally {
        rl.resume()
      }
      break
    }

    case 'logout': {
      const a = loadAuth()
      if (a?.token) {
        try { await fetch('https://codexyy.dev/auth/logout', { method:'POST', headers:{ Authorization:`Bearer ${a.token}` } }) } catch {}
      }
      clearAuth()
      renderer.printInfo('  Logged out.')
      rl.close()
      break
    }

    case 'whoami': {
      const a = loadAuth()
      if (a?.user) renderer.printInfo(`  ${a.user.name || ''} <${a.user.email}>  [${a.user.plan || 'free'}]`)
      else renderer.printInfo('  Not logged in')
      break
    }

    case 'model': {
      const arg = rest[0]
      if (arg) {
        const models = PROVIDER_MODELS[agent.provider] || []
        const n = parseInt(arg)
        const chosen = (n >= 1 && n <= models.length) ? models[n - 1].id : arg
        agent.model = chosen
        cfg.model = chosen
        saveConfig(cfg)
        renderer.printInfo(`  Model set to ${chosen}`)
      } else {
        await pickModel(agent, cfg, rl)
      }
      break
    }

    default:
      renderer.printError(`Unknown command: /${cmd}. Type /help.`)
  }
}

async function pickModel(agent, cfg, rl) {
  const provider = agent.provider
  let models = PROVIDER_MODELS[provider] || []

  if (provider === 'codexyy') {
    models = await fetchHostedModels(loadAuth()?.user?.plan || 'free')
  }

  if (provider === 'ollama') {
    try {
      const raw = execSync('ollama list 2>/dev/null', { timeout: 3000 }).toString()
      models = raw.trim().split('\n').slice(1)
        .map(l => l.split(/\s+/)[0]).filter(Boolean).filter(m => !m.startsWith('NAME'))
        .map(id => ({ id, label: id, tag: 'local' }))
    } catch {
      models = [{ id: agent.model, label: agent.model, tag: 'current' }]
    }
  }

  if (!models.length) {
    renderer.printInfo('  No models listed for this provider. Type: /model <model-id>')
    return
  }

  renderer.printInfo('\n  Available models:\n')
  models.forEach((m, i) => {
    const current = m.id === agent.model ? ' ← current' : ''
    const tag = m.tag ? ` [${m.tag}]` : ''
    renderer.printInfo(`  ${i + 1}.  ${(m.label || m.id).padEnd(30)}${tag}${current}`)
  })

  rl.pause()
  const answer = await ask(`\n  Enter 1-${models.length} or model ID (enter to cancel): `)
  rl.resume()

  if (!answer) return

  const n = parseInt(answer)
  const chosen = (n >= 1 && n <= models.length) ? models[n - 1].id : answer

  if (chosen) {
    agent.model = chosen
    cfg.model = chosen
    saveConfig(cfg)
    renderer.printInfo(`  Model set to ${chosen}\n`)
  }
}

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, ans => { rl.close(); resolve(ans.trim()) })
  })
}

function askOnce(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, ans => { rl.close(); resolve(ans.trim()) })
  })
}
