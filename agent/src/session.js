import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_DIR = join(homedir(), '.config', 'codexyy')
const SESSION_FILE = join(CONFIG_DIR, 'last-session.json')

export function saveSession(history, meta = {}) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(SESSION_FILE, JSON.stringify({
      history,
      savedAt: new Date().toISOString(),
      ...meta,
    }, null, 2))
    chmodSync(SESSION_FILE, 0o600)
  } catch {}
}

export function loadSession() {
  try {
    if (!existsSync(SESSION_FILE)) return null
    const s = JSON.parse(readFileSync(SESSION_FILE, 'utf8'))
    return s?.history?.length ? s : null
  } catch { return null }
}

export function clearSession() {
  try { writeFileSync(SESSION_FILE, '{}'); chmodSync(SESSION_FILE, 0o600) } catch {}
}

export function formatTimeAgo(date) {
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
