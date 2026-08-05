import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import chalk from 'chalk'

const AUTH_FILE = join(homedir(), '.config', 'codexyy', 'auth.json')
const API = 'https://codexyy.dev'

const C = {
  accent: chalk.hex('#4effa8'),
  dim:    chalk.gray,
  bold:   chalk.bold,
  err:    chalk.hex('#f87171'),
  blue:   chalk.hex('#7dd3fc'),
}

export function loadAuth() {
  try {
    if (existsSync(AUTH_FILE)) return JSON.parse(readFileSync(AUTH_FILE, 'utf8'))
  } catch {}
  return null
}

export function saveAuth(data) {
  mkdirSync(join(homedir(), '.config', 'codexyy'), { recursive: true })
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2))
  chmodSync(AUTH_FILE, 0o600)
}

export function clearAuth() {
  try { writeFileSync(AUTH_FILE, '{}'); chmodSync(AUTH_FILE, 0o600) } catch {}
}

export async function getToken() {
  const auth = loadAuth()
  return auth?.token || null
}

export async function login() {
  console.log('\n' + C.bold('  Sign in to codexyy\n'))

  // 1. Get a CLI code from the server
  let code, url
  try {
    const res = await fetch(`${API}/auth/cli-code`, { method: 'POST' })
    if (!res.ok) throw new Error(`Server returned ${res.status}`)
    const data = await res.json()
    code = data.code
    url  = data.url
  } catch (e) {
    console.log(C.err(`  Could not reach codexyy.dev: ${e.message}`))
    console.log(C.dim('  Check your internet connection and try again.\n'))
    process.exit(1)
  }

  // 2. Open browser
  console.log('  ' + C.dim('Opening browser to sign in...'))
  console.log('  ' + C.dim('If it does not open, visit:'))
  console.log('  ' + C.accent(url) + '\n')
  try {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    execSync(`${opener} ${url}`, { stdio: 'ignore' })
  } catch {}

  // 3. Poll for the token
  process.stdout.write('  ' + C.dim('Waiting for sign-in'))
  const token = await pollForToken(code)

  if (!token) {
    console.log('\n' + C.err('  Login timed out. Run codexyy again to retry.\n'))
    process.exit(1)
  }

  // 4. Fetch user info
  let user = {}
  try {
    const res = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) user = await res.json()
  } catch {}

  saveAuth({ token, user, saved_at: Date.now() })

  console.log('\n\n  ' + C.accent('Logged in') + ' as ' + C.bold(user.name || user.email || 'unknown') + '\n')
  return token
}

async function pollForToken(code, timeoutMs = 120000, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    process.stdout.write('.')
    try {
      const res = await fetch(`${API}/auth/poll/${code}`)
      if (res.status === 410) return null   // expired
      if (!res.ok) continue
      const data = await res.json()
      if (data.status === 'ok') return data.token
    } catch {}
  }
  return null
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
