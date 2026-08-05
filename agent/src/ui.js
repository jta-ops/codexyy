import chalk from 'chalk'
import { createPatch } from 'diff'

const C = {
  user:    chalk.hex('#7dd3fc'),
  ai:      chalk.hex('#86efac'),
  tool:    chalk.hex('#fbbf24'),
  err:     chalk.hex('#f87171'),
  dim:     chalk.gray,
  bold:    chalk.bold,
  accent:  chalk.hex('#a78bfa'),
  code:    chalk.hex('#e2e8f0'),
}

const SPINNER_WORDS = [
  'beaming','booping','bouncing','brewing','bubbling','chasing','churning',
  'coalescing','conjuring','cooking','crafting','crunching','cuddling','dancing',
  'dazzling','discovering','doodling','dreaming','drifting','enchanting','exploring',
  'finding','floating','fluttering','foraging','forging','frolicking','gathering',
  'giggling','gliding','greeting','growing','hatching','herding','honking','hopping',
  'hugging','humming','imagining','inventing','jingling','juggling','jumping',
  'kindling','knitting','launching','leaping','mapping','marinating','meandering',
  'mixing','moseying','munching','napping','nibbling','noodling','orbiting','painting',
  'percolating','petting','plotting','pondering','popping','prancing','purring',
  'puzzling','questing','riding','roaming','rolling','sauteeing','scribbling',
  'seeking','shimmying','singing','skipping','sleeping','snacking','sniffing',
  'snuggling','soaring','sparking','spinning','splashing','sprouting','squishing',
  'stargazing','stirring','strolling','swimming','swinging','tickling','tinkering',
  'toasting','tumbling','twirling','waddling','wandering','watching','weaving',
  'whistling','wibbling','wiggling','wishing','wobbling','wondering','yawning','zooming',
]

let spinnerTimer = null
let spinnerVisLen = 0

function spinnerWord() {
  return SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]
}

function spinnerTick() {
  const word = spinnerWord()
  const suffix = word + '...'
  const visLen = 'codexyy > '.length + suffix.length
  const pad = Math.max(0, spinnerVisLen - visLen)
  process.stdout.write('\r' + C.ai.bold('codexyy') + C.dim(' > ') + C.dim(suffix) + ' '.repeat(pad))
  spinnerVisLen = Math.max(visLen, spinnerVisLen)
  spinnerTimer = setTimeout(spinnerTick, 600)
}

function clearSpinner() {
  if (!spinnerTimer) return false
  clearTimeout(spinnerTimer)
  spinnerTimer = null
  spinnerVisLen = 0
  process.stdout.write('\r\x1b[K')  // carriage return + erase to end of line
  return true
}

export function printBanner() {
  const logo = `
  ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗██╗   ██╗██╗   ██╗
 ██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝╚██╗ ██╔╝╚██╗ ██╔╝
 ██║     ██║   ██║██║  ██║█████╗   ╚███╔╝  ╚████╔╝  ╚████╔╝
 ██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗   ╚██╔╝    ╚██╔╝
 ╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗   ██║      ██║
  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝   ╚═╝      ╚═╝   `
  console.log(C.accent(logo))
  console.log(C.dim('  AI coding agent for your terminal  |  type /help for commands\n'))
}

export function printHelp() {
  const cmds = [
    ['/help',            'Show this help'],
    ['/plan <task>',     'Plan a task before coding (safer for big changes)'],
    ['/undo <file>',     'Restore a file to before the last AI edit'],
    ['/git [status…]',   'git status / diff / log / commit <msg>'],
    ['/context',         'Show loaded project context file'],
    ['/clear',           'Clear conversation history'],
    ['/model',           'Pick a model'],
    ['/provider',        'Switch AI provider'],
    ['/setup',           'Re-run setup'],
    ['/cost',            'Show token usage'],
    ['/session',         'Show saved session info'],
    ['/prompt <text>',   'Set custom system instructions for this session'],
    ['/whoami',          'Show current account'],
    ['/logout',          'Sign out'],
    ['/exit',            'Exit (or Ctrl+D)'],
  ]
  console.log('\n' + C.bold('Commands:'))
  for (const [cmd, desc] of cmds) {
    console.log('  ' + C.accent(cmd.padEnd(16)) + C.dim(desc))
  }
  console.log()
}

export function printUser(text) {
  process.stdout.write('\n' + C.user.bold('You') + C.dim(' > ') + C.user(text) + '\n')
}

export function printAI(text) {
  if (clearSpinner()) {
    // Spinner was showing — rewrite prefix on the now-cleared line
    process.stdout.write(C.ai.bold('codexyy') + C.dim(' > '))
  }
  const rendered = text.replace(/`([^`]+)`/g, (_, m) => C.code('`' + m + '`'))
  process.stdout.write(C.ai(rendered))
}

export function printAIStart() {
  clearSpinner()
  process.stdout.write('\n')
  spinnerTick()
}

export function printAIEnd() {
  clearSpinner()
  process.stdout.write('\n')
}

export function printToolCall(name, input) {
  clearSpinner()
  const args = formatArgs(input)
  process.stdout.write('\n' + C.tool('  - ' + name) + C.dim('(' + args + ')') + ' ')
}

export function printToolResult(name, result, durationMs) {
  const ms = durationMs ? C.dim(` ${durationMs}ms`) : ''
  if (result.error) {
    process.stdout.write(C.err('error') + ms + '\n')
    console.log(C.err('    ' + result.error))
    return
  }
  if (name === 'write_file') {
    process.stdout.write(C.ai('written') + ms + '\n')
    if (result.patch) printDiff(result.patch)
    return
  }
  if (name === 'run_bash') {
    const ok = result.exit_code === 0
    process.stdout.write((ok ? C.ai('ok') : C.err('exit ' + result.exit_code)) + ms + '\n')
    const out = (result.stdout || '').trim()
    const err = (result.stderr || '').trim()
    if (out) printBlock(out, '    ')
    if (err) printBlock(err, '    ', true)
    return
  }
  if (name === 'read_file') {
    process.stdout.write(C.ai(`${result.lines} lines`) + ms + '\n')
    return
  }
  if (name === 'list_directory') {
    process.stdout.write(C.ai('ok') + ms + '\n')
    printBlock(result.tree, '    ')
    return
  }
  if (name === 'search_files' || name === 'find_files') {
    const count = name === 'find_files' ? result.count : (result.matches === '(no matches)' ? 0 : result.matches.split('\n').length)
    process.stdout.write(C.ai(count + ' results') + ms + '\n')
    if (result.matches && result.matches !== '(no matches)') printBlock(result.matches, '    ')
    if (result.files?.length) printBlock(result.files.join('\n'), '    ')
    return
  }
  process.stdout.write(C.ai('done') + ms + '\n')
}

export function printError(msg) {
  clearSpinner()
  console.error('\n' + C.err('Error: ' + msg) + '\n')
}

export function printInfo(msg) {
  console.log(C.dim(msg))
}

export function printCost(usage) {
  const { input = 0, output = 0, cache_read = 0, cache_write = 0, contextWindow = 0, model = '' } = usage
  console.log('\n' + C.bold('Token usage:'))
  if (model) console.log(`  Model:       ${C.accent(model)}`)
  console.log(`  Input:       ${C.accent(input.toLocaleString())}`)
  console.log(`  Output:      ${C.accent(output.toLocaleString())}`)
  if (cache_read)  console.log(`  Cache read:  ${C.accent(cache_read.toLocaleString())}`)
  if (cache_write) console.log(`  Cache write: ${C.accent(cache_write.toLocaleString())}`)
  const cost = estimateCost(input, output, cache_read, cache_write)
  console.log(`  Est. cost:   ${C.accent('$' + cost.toFixed(4))}`)
  if (contextWindow) {
    const percent = Math.min(100, (input / contextWindow) * 100)
    console.log(`  Context:     ${C.accent(percent.toFixed(1) + '%')} ${C.dim(`of ${contextWindow.toLocaleString()} tokens`)}`)
  }
  console.log()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatArgs(obj) {
  const keys = Object.keys(obj)
  if (!keys.length) return ''
  return keys.map(k => {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 40) return `${k}="${v.slice(0, 37)}..."`
    if (typeof v === 'string') return `${k}="${v}"`
    return `${k}=${JSON.stringify(v)}`
  }).join(', ')
}

function printBlock(text, indent = '', isErr = false) {
  const lines = text.split('\n').slice(0, 30)
  const color = isErr ? C.err : C.dim
  for (const line of lines) {
    console.log(color(indent + line))
  }
  if (text.split('\n').length > 30) {
    console.log(C.dim(indent + `... (${text.split('\n').length - 30} more lines)`))
  }
}

function printDiff(patch) {
  const lines = patch.split('\n').slice(4) // skip headers
  for (const line of lines) {
    if (line.startsWith('+')) process.stdout.write(chalk.green('    ' + line) + '\n')
    else if (line.startsWith('-')) process.stdout.write(chalk.red('    ' + line) + '\n')
    else if (line.startsWith('@')) process.stdout.write(C.dim('    ' + line) + '\n')
    else process.stdout.write(C.dim('    ' + line) + '\n')
  }
}

function estimateCost(input, output, cacheRead, cacheWrite) {
  // claude-sonnet-4-6 pricing
  const inputCost  = (input  / 1e6) * 3.00
  const outputCost = (output / 1e6) * 15.00
  const crCost     = (cacheRead  / 1e6) * 0.30
  const cwCost     = (cacheWrite / 1e6) * 3.75
  return inputCost + outputCost + crCost + cwCost
}
