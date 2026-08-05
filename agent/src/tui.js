import blessed from 'blessed'
import chalk from 'chalk'

// ── TUI layout ────────────────────────────────────────────────────────────────
// ┌─ status bar ──────────────────────────────────────────────────────────────┐
// │  chat area (scrollable)                                                    │
// │                                                                            │
// ├─ divider ──────────────────────────────────────────────────────────────────┤
// │  You > [input]                                                             │
// └───────────────────────────────────────────────────────────────────────────┘

const ACCENT = '#4effa8'
const AI_COL = '#86efac'
const USER_COL = '#7dd3fc'
const TOOL_COL = '#fbbf24'
const ERR_COL  = '#f87171'
const DIM_COL  = '#6b7280'

// Strip ANSI codes — blessed handles its own tags
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

// Convert chalk-colored text to blessed tags
function chalkToBl(str) {
  return stripAnsi(str)
}

export class TUI {
  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'codexyy',
      fullUnicode: true,
      forceUnicode: true,
    })

    // Status bar (top, 1 line)
    this.statusBar = blessed.box({
      top: 0, left: 0,
      width: '100%', height: 1,
      tags: true,
      style: { fg: 'black', bg: '#4effa8', bold: true },
      content: ' codexyy',
    })

    // Chat area
    this.chatBox = blessed.log({
      top: 1, left: 0,
      width: '100%',
      height: this.screen.height - 4,
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      scrollbar: {
        ch: '│',
        style: { fg: DIM_COL },
      },
      style: { fg: 'white', bg: 'default' },
      border: false,
      padding: { left: 1, right: 1 },
    })

    // Divider
    this.divider = blessed.line({
      top: this.screen.height - 3, left: 0,
      width: '100%', height: 1,
      orientation: 'horizontal',
      style: { fg: DIM_COL },
    })

    // Input bar
    this.inputBar = blessed.textbox({
      bottom: 0, left: 0,
      width: '100%', height: 3,
      inputOnFocus: true,
      keys: true,
      mouse: true,
      tags: false,
      style: {
        fg: USER_COL,
        border: { fg: '#374151' },
      },
      border: { type: 'line' },
      padding: { left: 1 },
    })

    // Autocomplete popup (hidden by default)
    this.autocompleteBox = blessed.list({
      bottom: 3, left: 0,
      width: 32, height: 1,
      tags: true,
      hidden: true,
      keys: false,
      mouse: false,
      style: {
        item: { fg: 'white', bg: '#1f2937' },
        selected: { fg: '#4effa8', bg: '#374151', bold: true },
        border: { fg: DIM_COL },
      },
      border: { type: 'line' },
      padding: { left: 1 },
    })

    this.screen.append(this.statusBar)
    this.screen.append(this.chatBox)
    this.screen.append(this.divider)
    this.screen.append(this.autocompleteBox)
    this.screen.append(this.inputBar)

    // Resize handler
    this.screen.on('resize', () => {
      this.chatBox.height = this.screen.height - 4
      this.divider.top = this.screen.height - 3
      this.screen.render()
    })

    this._inputHandlers = []
    this._currentLine = ''
    this._aiBuffer = ''
    this._inAI = false
    this._acItems = []
    this._acIdx = -1

    this._bindKeys()
    this._bindAutocomplete()
    this.inputBar.focus()
    this.screen.render()
  }

  _bindAutocomplete() {
    const CMDS = [
      'help','plan','undo','git','context','clear','model',
      'provider','setup','cost','session','prompt','whoami','logout','exit'
    ]

    // Watch every keypress on the input bar
    this.inputBar.on('keypress', (ch, key) => {
      // Let enter/arrows be handled by _bindKeys first
      setImmediate(() => {
        const val = this.inputBar.getValue()
        if (!val.startsWith('/')) {
          this._hideAC()
          return
        }
        const typed = val.slice(1).toLowerCase()
        this._acItems = typed ? CMDS.filter(c => c.startsWith(typed)) : CMDS
        this._acIdx = this._acItems.length === 1 ? 0 : -1
        this._showAC()
      })
    })
  }

  _showAC() {
    if (!this._acItems.length) { this._hideAC(); return }
    const items = this._acItems.map((c, i) =>
      i === this._acIdx ? `{#4effa8-fg}/${c}{/}` : `{gray-fg}/${c}{/}`
    )
    this.autocompleteBox.setItems(items)
    const h = Math.min(this._acItems.length + 2, 10)
    this.autocompleteBox.height = h
    this.autocompleteBox.show()
    if (this._acIdx >= 0) this.autocompleteBox.select(this._acIdx)
    this.screen.render()
  }

  _hideAC() {
    this._acItems = []
    this._acIdx = -1
    this.autocompleteBox.hide()
    this.screen.render()
  }

  _bindKeys() {
    // Ctrl+D = exit
    this.screen.key(['C-d'], () => {
      this.emit('close')
    })
    // Ctrl+C = interrupt (don't exit)
    this.screen.key(['C-c'], () => {
      this.inputBar.clearValue()
      this._hideAC()
      this.screen.render()
      this.emit('interrupt')
    })
    // Escape = hide autocomplete
    this.inputBar.key(['escape'], () => {
      this._hideAC()
    })
    // Tab = complete first match
    this.inputBar.key(['tab'], () => {
      if (this._acItems.length) {
        const pick = this._acItems[this._acIdx >= 0 ? this._acIdx : 0]
        this.inputBar.setValue(`/${pick} `)
        this._hideAC()
        this.screen.render()
      }
    })
    // Up = move autocomplete selection up
    this.inputBar.key(['up'], () => {
      if (this._acItems.length) {
        this._acIdx = this._acIdx <= 0 ? this._acItems.length - 1 : this._acIdx - 1
        this._showAC()
      }
    })
    // Down = move autocomplete selection down
    this.inputBar.key(['down'], () => {
      if (this._acItems.length) {
        this._acIdx = this._acIdx >= this._acItems.length - 1 ? 0 : this._acIdx + 1
        this._showAC()
      }
    })
    // Enter = autocomplete if one match, else submit
    this.inputBar.key('enter', () => {
      if (this._acItems.length === 1) {
        const pick = this._acItems[0]
        const cur = this.inputBar.getValue()
        // Only autocomplete if still partial (no space yet)
        if (!cur.includes(' ') && cur.startsWith('/')) {
          this.inputBar.setValue(`/${pick} `)
          this._hideAC()
          this.screen.render()
          return
        }
      }
      const val = this.inputBar.getValue().trim()
      this.inputBar.clearValue()
      this._hideAC()
      this.screen.render()
      if (val) this.emit('line', val)
    })
    // Ctrl+L = clear screen
    this.screen.key(['C-l'], () => {
      this.chatBox.setContent('')
      this.screen.render()
    })
    // Page Up/Down for scroll
    this.screen.key(['pageup'], () => { this.chatBox.scroll(-this.chatBox.height); this.screen.render() })
    this.screen.key(['pagedown'], () => { this.chatBox.scroll(this.chatBox.height); this.screen.render() })
  }

  _handlers = {}
  on(event, fn) { this._handlers[event] = fn }
  emit(event, ...args) { this._handlers[event]?.(...args) }

  setStatus(provider, model, extras = '') {
    const left = ` codexyy  │  ${provider}  │  ${model}`
    const right = extras ? `  ${extras} ` : ''
    const pad = Math.max(0, this.screen.width - left.length - right.length)
    this.statusBar.setContent(left + ' '.repeat(pad) + right)
    this.screen.render()
  }

  // Add a line to the chat log
  _log(text) {
    this.chatBox.log(text)
    this.screen.render()
  }

  printUser(text) {
    this._log('')
    this._log(`{bold}{cyan-fg}You{/} {gray-fg}>{/} {cyan-fg}${escBl(text)}{/}`)
  }

  printAIStart() {
    this._log('')
    this._aiBuffer = ''
    this._inAI = true
    this._aiLine = `{bold}{green-fg}codexyy{/} {gray-fg}>{/} `
    this._spinnerWord = spinnerWord()
    this._updateAILine()
    if (this._spinnerTimer) clearInterval(this._spinnerTimer)
    this._spinnerTimer = setInterval(() => {
      this._spinnerWord = spinnerWord()
      this._updateAILine()
    }, 600)
  }

  _updateAILine() {
    if (this._inAI && !this._aiBuffer) {
      // Still showing spinner
      this._chatBox_replaceLast(`{bold}{green-fg}codexyy{/} {gray-fg}>{/} {gray-fg}${this._spinnerWord}...{/}`)
    }
  }

  _chatBox_replaceLast(line) {
    const lines = this.chatBox.getLines()
    if (lines.length === 0) {
      this.chatBox.log(line)
    } else {
      // Remove last line and replace
      const content = this.chatBox.getContent()
      const parts = content.split('\n')
      parts[parts.length - 1] = line
      this.chatBox.setContent(parts.join('\n'))
      this.chatBox.scrollTo(this.chatBox.getScrollHeight())
    }
    this.screen.render()
  }

  printAI(text) {
    if (this._spinnerTimer) {
      clearInterval(this._spinnerTimer)
      this._spinnerTimer = null
    }
    this._aiBuffer += text
    // Replace the last line with accumulated AI text
    this._chatBox_replaceLast(`{bold}{green-fg}codexyy{/} {gray-fg}>{/} {green-fg}${escBl(this._aiBuffer)}{/}`)
  }

  printAIEnd() {
    if (this._spinnerTimer) {
      clearInterval(this._spinnerTimer)
      this._spinnerTimer = null
    }
    this._inAI = false
    if (!this._aiBuffer) {
      // Remove empty spinner line
      const content = this.chatBox.getContent()
      const parts = content.split('\n')
      parts.pop()
      this.chatBox.setContent(parts.join('\n'))
    }
    this._aiBuffer = ''
    this.screen.render()
  }

  printToolCall(name, input) {
    if (this._spinnerTimer) {
      clearInterval(this._spinnerTimer)
      this._spinnerTimer = null
    }
    const args = Object.entries(input).map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return `${k}="${s.length > 40 ? s.slice(0, 37) + '...' : s}"`
    }).join(', ')
    this._log(`  {yellow-fg}→ ${escBl(name)}{/}{gray-fg}(${escBl(args)}){/} `)
  }

  printToolResult(name, result, ms) {
    const time = ms ? `{gray-fg} ${ms}ms{/}` : ''
    if (result.error) {
      this._replaceLastAppend(`{red-fg}error{/}${time}`)
      this._log(`  {red-fg}${escBl(result.error)}{/}`)
      return
    }
    if (name === 'write_file' || name === 'replace_in_file') {
      this._replaceLastAppend(`{green-fg}written{/}${time}`)
      if (result.patch) this._logDiff(result.patch)
      return
    }
    if (name === 'run_bash') {
      const ok = result.exit_code === 0
      this._replaceLastAppend(ok ? `{green-fg}ok{/}${time}` : `{red-fg}exit ${result.exit_code}{/}${time}`)
      const out = (result.stdout || '').trim()
      const err = (result.stderr || '').trim()
      if (out) this._logBlock(out)
      if (err) this._logBlock(err, true)
      return
    }
    this._replaceLastAppend(`{green-fg}done{/}${time}`)
  }

  _replaceLastAppend(suffix) {
    const content = this.chatBox.getContent()
    const parts = content.split('\n')
    parts[parts.length - 1] = parts[parts.length - 1] + suffix
    this.chatBox.setContent(parts.join('\n'))
    this.chatBox.scrollTo(this.chatBox.getScrollHeight())
    this.screen.render()
  }

  _logBlock(text, isErr = false) {
    const lines = text.split('\n').slice(0, 20)
    for (const line of lines) {
      this._log(`  ${isErr ? '{red-fg}' : '{gray-fg}'}${escBl(line)}{/}`)
    }
    if (text.split('\n').length > 20) {
      this._log(`  {gray-fg}... (${text.split('\n').length - 20} more lines){/}`)
    }
  }

  _logDiff(patch) {
    const lines = patch.split('\n').slice(4, 40)
    for (const line of lines) {
      if (line.startsWith('+')) this._log(`  {green-fg}${escBl(line)}{/}`)
      else if (line.startsWith('-')) this._log(`  {red-fg}${escBl(line)}{/}`)
      else this._log(`  {gray-fg}${escBl(line)}{/}`)
    }
  }

  printError(msg) {
    if (this._spinnerTimer) { clearInterval(this._spinnerTimer); this._spinnerTimer = null }
    this._log('')
    this._log(`{red-fg}Error: ${escBl(msg)}{/}`)
    this._log('')
    this.screen.render()
  }

  printInfo(msg) {
    this._log(`{gray-fg}${escBl(stripAnsi(msg))}{/}`)
    this.screen.render()
  }

  printHelp() {
    const cmds = [
      ['/help',            'Show this help'],
      ['/plan <task>',     'Plan a task before coding'],
      ['/undo <file>',     'Restore a file to before the last AI edit'],
      ['/git [status…]',   'git status / diff / log / commit <msg>'],
      ['/context',         'Show loaded project context file'],
      ['/clear',           'Clear conversation history'],
      ['/model',           'Pick a model'],
      ['/provider',        'Switch AI provider'],
      ['/setup',           'Re-run setup'],
      ['/cost',            'Show token usage'],
      ['/session',         'Show saved session info'],
      ['/prompt <text>',   'Set custom system instructions'],
      ['/whoami',          'Show current account'],
      ['/logout',          'Sign out'],
      ['/exit',            'Exit (or Ctrl+D)'],
    ]
    this._log('')
    this._log('{bold}{white-fg}Commands:{/}')
    for (const [cmd, desc] of cmds) {
      this._log(`  {#a78bfa-fg}${escBl(cmd.padEnd(18))}{/}{gray-fg}${escBl(desc)}{/}`)
    }
    this._log('')
    this.screen.render()
  }

  printCost(usage) {
    const { input = 0, output = 0, contextWindow = 0, model = '' } = usage
    this._log('')
    this._log('{bold}{white-fg}Token usage:{/}')
    if (model) this._log(`  {gray-fg}Model:  {/}{#a78bfa-fg}${escBl(model)}{/}`)
    this._log(`  {gray-fg}Input:  {/}{#a78bfa-fg}${input.toLocaleString()}{/}`)
    this._log(`  {gray-fg}Output: {/}{#a78bfa-fg}${output.toLocaleString()}{/}`)
    if (contextWindow) this._log(`  {gray-fg}Context:{/}{#a78bfa-fg}${Math.min(100, input / contextWindow * 100).toFixed(1)}%{/}`)
    this._log('')
    this.screen.render()
  }

  printBanner() {
    const lines = [
      '{#4effa8-fg}  ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗██╗   ██╗██╗   ██╗{/}',
      '{#4effa8-fg} ██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝╚██╗ ██╔╝╚██╗ ██╔╝{/}',
      '{#4effa8-fg} ██║     ██║   ██║██║  ██║█████╗   ╚███╔╝  ╚████╔╝  ╚████╔╝ {/}',
      '{#4effa8-fg} ██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗   ╚██╔╝    ╚██╔╝  {/}',
      '{#4effa8-fg} ╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗   ██║      ██║   {/}',
      '{#4effa8-fg}  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝   ╚═╝      ╚═╝  {/}',
    ]
    for (const l of lines) this.chatBox.log(l)
    this.chatBox.log('{gray-fg}  AI coding agent  |  /help for commands  |  Ctrl+D to exit{/}')
    this.chatBox.log('')
    this.screen.render()
  }

  destroy() {
    if (this._spinnerTimer) clearInterval(this._spinnerTimer)
    try { this.screen.destroy() } catch {}
  }
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

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

function spinnerWord() {
  return SPINNER_WORDS[Math.floor(Math.random() * SPINNER_WORDS.length)]
}

// Escape blessed tag chars
function escBl(str) {
  return String(str).replace(/[{}]/g, c => c === '{' ? '\\{' : '\\}')
}
