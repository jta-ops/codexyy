import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_DIR = join(homedir(), '.config', 'codexyy')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

const DEFAULTS = {
  provider: null,   // set during setup
  model: null,
}

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
  chmodSync(CONFIG_FILE, 0o600)
}
