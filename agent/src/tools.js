import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { execSync, exec } from 'child_process'
import { dirname, join, resolve, basename } from 'path'
import { homedir } from 'os'
import { promisify } from 'util'
import { createPatch } from 'diff'

const execAsync = promisify(exec)

const IGNORE = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.next', '.nuxt', 'coverage', '.DS_Store'])

const BACKUP_DIR = join(homedir(), '.config', 'codexyy', 'backups')

// ─── File tree ────────────────────────────────────────────────────────────────

function walkDir(dir, depth = 0, max = 4) {
  if (depth > max) return []
  const entries = []
  try {
    for (const name of readdirSync(dir).sort()) {
      if (IGNORE.has(name)) continue
      const full = join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        entries.push({ type: 'dir', name, path: full, children: walkDir(full, depth + 1, max) })
      } else {
        entries.push({ type: 'file', name, path: full, size: stat.size })
      }
    }
  } catch {}
  return entries
}

function treeText(entries, prefix = '') {
  let out = ''
  entries.forEach((e, i) => {
    const last = i === entries.length - 1
    const branch = last ? '└── ' : '├── '
    const child  = last ? '    ' : '│   '
    out += prefix + branch + e.name + (e.type === 'dir' ? '/' : '') + '\n'
    if (e.type === 'dir' && e.children?.length) {
      out += treeText(e.children, prefix + child)
    }
  })
  return out
}

function saveBackup(filePath, content) {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true })
    const abs = resolve(filePath)
    const safe = abs.replace(/[/\\:]/g, '_').replace(/^_+/, '')
    writeFileSync(join(BACKUP_DIR, `${Date.now()}__${safe}`), content, 'utf8')
  } catch {}
}

// ─── Tool implementations ─────────────────────────────────────────────────────

export const toolHandlers = {

  async read_file({ path }) {
    if (!existsSync(path)) return { error: `File not found: ${path}` }
    try {
      const content = readFileSync(path, 'utf8')
      return { path, content, lines: content.split('\n').length }
    } catch (e) {
      return { error: e.message }
    }
  },

  async write_file({ path, content }) {
    const exists = existsSync(path)
    const old = exists ? readFileSync(path, 'utf8') : ''
    if (exists) saveBackup(path, old)
    const patch = createPatch(path, old, content, '', '')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
    return { path, created: !exists, patch }
  },

  async replace_in_file({ path, old_str, new_str }) {
    if (!existsSync(path)) return { error: `File not found: ${path}` }
    const content = readFileSync(path, 'utf8')
    if (!content.includes(old_str)) return { error: `String not found in ${path}. Read the file first to get the exact text.` }
    saveBackup(path, content)
    const newContent = content.replace(old_str, new_str)
    const patch = createPatch(path, content, newContent, '', '')
    writeFileSync(path, newContent, 'utf8')
    return { path, patch }
  },

  async restore_file({ path }) {
    const abs = resolve(path)
    const safe = abs.replace(/[/\\:]/g, '_').replace(/^_+/, '')
    let backups = []
    try { backups = readdirSync(BACKUP_DIR).filter(f => f.endsWith(`__${safe}`)).sort().reverse() } catch {}
    if (!backups.length) return { error: `No backup found for ${path}` }
    const content = readFileSync(join(BACKUP_DIR, backups[0]), 'utf8')
    writeFileSync(abs, content, 'utf8')
    return { restored: abs }
  },

  async list_directory({ path = '.', depth = 2 }) {
    const entries = walkDir(path, 0, depth)
    const tree = treeText(entries)
    return { path, tree: tree || '(empty)', entries: entries.length }
  },

  async search_files({ pattern, directory = '.', include = '**', case_sensitive = false }) {
    try {
      const flags = case_sensitive ? '' : '-i'
      const { stdout } = await execAsync(
        `grep -r ${flags} --include="*.{js,ts,py,go,rs,java,c,cpp,h,jsx,tsx,json,yaml,yml,md,sh}" -n "${pattern}" "${directory}" 2>/dev/null | head -50`,
        { timeout: 10000 }
      )
      return { matches: stdout.trim() || '(no matches)', pattern }
    } catch {
      return { matches: '(no matches)', pattern }
    }
  },

  async run_bash({ command, timeout = 30000 }) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' }
      })
      return {
        stdout: stdout.slice(0, 8000),
        stderr: stderr.slice(0, 2000),
        exit_code: 0
      }
    } catch (e) {
      return {
        stdout: (e.stdout || '').slice(0, 8000),
        stderr: (e.stderr || e.message || '').slice(0, 2000),
        exit_code: e.code || 1
      }
    }
  },

  async find_files({ pattern, directory = '.' }) {
    try {
      const { stdout } = await execAsync(
        `find "${directory}" -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -30`,
        { timeout: 5000 }
      )
      const files = stdout.trim().split('\n').filter(Boolean)
      return { files, count: files.length }
    } catch {
      return { files: [], count: 0 }
    }
  },

  async git_status({ path = '.' }) {
    try {
      const { stdout: status } = await execAsync('git status --short', { cwd: resolve(path), timeout: 5000 })
      const { stdout: branch } = await execAsync('git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD', { cwd: resolve(path), timeout: 5000 })
      return { branch: branch.trim(), status: status.trim() || '(clean)', path }
    } catch (e) {
      return { error: e.message }
    }
  },

  async git_diff({ path = '.', staged = false, file = '' }) {
    try {
      const target = file ? `-- "${file}"` : ''
      const cmd = staged ? `git diff --staged ${target}` : `git diff ${target}`
      const { stdout } = await execAsync(cmd, { cwd: resolve(path), timeout: 10000 })
      return { diff: stdout.trim() || '(no changes)', staged }
    } catch (e) {
      return { error: e.message }
    }
  },

  async git_log({ path = '.', count = 10 }) {
    try {
      const { stdout } = await execAsync(`git log --oneline -${count}`, { cwd: resolve(path), timeout: 5000 })
      return { log: stdout.trim() || '(no commits)' }
    } catch (e) {
      return { error: e.message }
    }
  },

  async git_commit({ message, path = '.', add_all = true }) {
    try {
      if (add_all) await execAsync('git add -A', { cwd: resolve(path), timeout: 10000 })
      const safe = message.replace(/"/g, '\\"')
      const { stdout } = await execAsync(`git commit -m "${safe}"`, { cwd: resolve(path), timeout: 10000 })
      return { output: stdout.trim() }
    } catch (e) {
      return { error: (e.stderr || e.message || '').trim() }
    }
  },
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const toolDefs = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Always read before editing.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write full content to a file (creates or overwrites). Use replace_in_file for targeted edits to large files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to write to' },
        content: { type: 'string', description: 'Full file content' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'replace_in_file',
    description: 'Replace an exact string in a file. More efficient than rewriting the whole file. Fails if the string is not found — read the file first.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file' },
        old_str: { type: 'string', description: 'Exact string to find and replace' },
        new_str: { type: 'string', description: 'Replacement string' }
      },
      required: ['path', 'old_str', 'new_str']
    }
  },
  {
    name: 'restore_file',
    description: 'Restore a file to its state before the last write_file or replace_in_file call. Use this to undo AI edits.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to restore' }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files in a directory as a tree. Use to understand project structure.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to list', default: '.' },
        depth: { type: 'number', description: 'Max depth (1-4)', default: 2 }
      }
    }
  },
  {
    name: 'search_files',
    description: 'Search for a pattern across files using grep.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex or literal)' },
        directory: { type: 'string', description: 'Directory to search', default: '.' },
        case_sensitive: { type: 'boolean', default: false }
      },
      required: ['pattern']
    }
  },
  {
    name: 'run_bash',
    description: 'Run a shell command. Use for tests, builds, installs, git, etc. If a command fails, read the error and fix it.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        timeout: { type: 'number', description: 'Timeout ms (default 30000)', default: 30000 }
      },
      required: ['command']
    }
  },
  {
    name: 'find_files',
    description: 'Find files by name pattern (e.g. "*.test.ts", "Dockerfile").',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Filename glob pattern' },
        directory: { type: 'string', description: 'Directory to search', default: '.' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'git_status',
    description: 'Show current git branch and changed files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path (default: cwd)', default: '.' }
      }
    }
  },
  {
    name: 'git_diff',
    description: 'Show git diff for unstaged or staged changes.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path', default: '.' },
        staged: { type: 'boolean', description: 'Show staged diff', default: false },
        file: { type: 'string', description: 'Limit to a specific file', default: '' }
      }
    }
  },
  {
    name: 'git_log',
    description: 'Show recent git commits.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', default: '.' },
        count: { type: 'number', description: 'Number of commits to show', default: 10 }
      }
    }
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and create a git commit.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message' },
        path: { type: 'string', description: 'Repo path', default: '.' },
        add_all: { type: 'boolean', description: 'Stage all changes before committing', default: true }
      },
      required: ['message']
    }
  },
]
