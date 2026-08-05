import * as readline from 'readline'
import chalk from 'chalk'
import { execSync } from 'child_process'
import { saveConfig, loadConfig } from './config.js'
import { loadAuth } from './auth.js'
import { fetchHostedModels } from './ai.js'

const C = {
  accent:  chalk.hex('#4effa8'),
  dim:     chalk.gray,
  bold:    chalk.bold,
  err:     chalk.hex('#f87171'),
  blue:    chalk.hex('#7dd3fc'),
  yellow:  chalk.hex('#fbbf24'),
}

const PROVIDERS = [
  {
    id: 'codexyy',
    label: 'codexyy free',
    tag: '30 msgs/week',
    tagColor: C.accent,
    desc: 'Codexyy hosted models, automatically matched to your plan. No provider key.',
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    needsKey: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    tag: 'recommended',
    tagColor: C.accent,
    desc: 'claude-sonnet-4-6 by default. Best for coding.',
    defaultModel: 'claude-sonnet-4-6',
    needsKey: true,
    keyName: 'ANTHROPIC_API_KEY',
    keyHint: 'Get one at console.anthropic.com',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    tag: 'any model',
    tagColor: C.yellow,
    desc: 'Claude, GPT-4o, Gemini, DeepSeek + more. Your key.',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    needsKey: true,
    keyName: 'OPENROUTER_API_KEY',
    keyHint: 'Get one at openrouter.ai/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    tag: 'BYOK',
    tagColor: C.dim,
    desc: 'gpt-4o, o3-mini, etc. Bring your own key.',
    defaultModel: 'gpt-4o',
    needsKey: true,
    keyName: 'OPENAI_API_KEY',
    keyHint: 'Get one at platform.openai.com',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    tag: 'local / free',
    tagColor: C.blue,
    desc: 'Run models on your machine. No key needed.',
    defaultModel: 'qwen2.5-coder:7b',
    needsKey: false,
  },
]

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, ans => { rl.close(); resolve(ans.trim()) })
  })
}

function askHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question)
    const rl = readline.createInterface({ input: process.stdin, output: null, terminal: false })
    let val = ''
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.once('data', function handler(buf) {
      // Fall back to normal readline if raw mode unavailable
      process.stdin.setRawMode?.(false)
      rl.close()
      resolve(buf.toString().trim())
    })
    // Safer fallback: just use regular prompt
    rl.once('line', line => {
      process.stdin.setRawMode?.(false)
      resolve(line.trim())
    })
  })
}

function detectOllamaModels() {
  try {
    const out = execSync('ollama list 2>/dev/null', { timeout: 3000 }).toString()
    const lines = out.trim().split('\n').slice(1) // skip header
    return lines
      .map(l => l.split(/\s+/)[0])
      .filter(Boolean)
      .filter(m => !m.startsWith('NAME'))
  } catch {
    return []
  }
}

export async function runSetup() {
  console.log('\n' + C.bold('  Welcome to codexyy!') + C.dim(' Let\'s get you set up.\n'))
  console.log(C.dim('  ─────────────────────────────────────────\n'))
  console.log('  ' + C.bold('Which AI provider do you want to use?\n'))

  PROVIDERS.forEach((p, i) => {
    const num = C.accent(`  ${i + 1}.`)
    const label = C.bold(p.label.padEnd(20))
    const tag = p.tagColor(`[${p.tag}]`)
    console.log(`${num} ${label} ${tag}`)
    console.log(`     ${C.dim(p.desc)}`)
    console.log()
  })

  let choice = ''
  while (true) {
    choice = await ask(C.dim('  Enter 1-5: '))
    const n = parseInt(choice)
    if (n >= 1 && n <= PROVIDERS.length) break
    console.log(C.err('  Invalid choice. Enter 1-5.'))
  }

  const provider = PROVIDERS[parseInt(choice) - 1]
  console.log(`\n  ${C.accent('>')} Using ${C.bold(provider.label)}\n`)

  const cfg = loadConfig()
  cfg.provider = provider.id
  cfg.model = provider.defaultModel

  if (provider.id === 'anthropic') {
    const envKey = process.env.ANTHROPIC_API_KEY
    if (envKey) {
      console.log(C.dim('  Using ANTHROPIC_API_KEY from environment.\n'))
      cfg.api_key = envKey
    } else {
      console.log(C.dim(`  ${provider.keyHint}`))
      const key = await ask('  Paste your API key: ')
      if (!key) { console.log(C.err('  No key provided. Exiting.')); process.exit(1) }
      cfg.api_key = key
    }

    console.log('\n  ' + C.bold('Which model?') + C.dim('  (enter to use default)\n'))
    const models = [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tag: 'recommended - fast + smart' },
      { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7',   tag: 'most capable, slower' },
      { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  tag: 'fastest, cheapest' },
    ]
    models.forEach((m, i) => {
      const tag = m.id === provider.defaultModel ? C.accent(`[${m.tag}]`) : C.dim(`[${m.tag}]`)
      console.log(`  ${C.accent(i + 1 + '.')} ${m.label.padEnd(24)} ${tag}`)
    })
    const mc = await ask(C.dim('\n  Enter 1-3 (default 1): '))
    const mi = parseInt(mc) - 1
    if (mi >= 0 && mi < models.length) cfg.model = models[mi].id
    console.log()
  }

  if (provider.id === 'openai') {
    const envKey = process.env.OPENAI_API_KEY
    if (envKey) {
      console.log(C.dim('  Using OPENAI_API_KEY from environment.\n'))
      cfg.openai_key = envKey
    } else {
      console.log(C.dim(`  ${provider.keyHint}`))
      const key = await ask('  Paste your API key: ')
      if (!key) { console.log(C.err('  No key provided. Exiting.')); process.exit(1) }
      cfg.openai_key = key
    }

    console.log('\n  ' + C.bold('Which model?') + C.dim('  (enter to use default)\n'))
    const models = [
      { id: 'gpt-4o',       label: 'GPT-4o',     tag: 'recommended' },
      { id: 'gpt-4o-mini',  label: 'GPT-4o mini', tag: 'faster, cheaper' },
      { id: 'o3-mini',      label: 'o3-mini',     tag: 'reasoning' },
    ]
    models.forEach((m, i) => {
      const tag = m.id === provider.defaultModel ? C.accent(`[${m.tag}]`) : C.dim(`[${m.tag}]`)
      console.log(`  ${C.accent(i + 1 + '.')} ${m.label.padEnd(16)} ${tag}`)
    })
    const mc = await ask(C.dim('\n  Enter 1-3 (default 1): '))
    const mi = parseInt(mc) - 1
    if (mi >= 0 && mi < models.length) cfg.model = models[mi].id
    console.log()
  }

  if (provider.id === 'ollama') {
    console.log(C.dim('  Checking for Ollama...'))
    const models = detectOllamaModels()
    if (!models.length) {
      console.log(C.err('  Ollama not found or no models installed.'))
      console.log(C.dim('  Install: https://ollama.com  then: ollama pull qwen2.5-coder:7b\n'))
      const manual = await ask('  Or enter a model name manually (e.g. llama3): ')
      if (!manual) { console.log(C.err('  No model. Exiting.')); process.exit(1) }
      cfg.model = manual
    } else {
      console.log(`\n  ${C.bold('Available models:')}\n`)
      models.forEach((m, i) => {
        console.log(`  ${C.accent(i + 1 + '.')} ${m}`)
      })
      const mc = await ask(C.dim(`\n  Enter 1-${models.length} (default 1): `))
      const mi = parseInt(mc) - 1
      cfg.model = (mi >= 0 && mi < models.length) ? models[mi] : models[0]
      console.log()
    }
    cfg.ollama_url = 'http://localhost:11434'
  }

  if (provider.id === 'codexyy') {
    const auth = loadAuth()
    if (!auth?.token) {
      console.log(C.err('  Not logged in. Restart codexyy to sign in first.\n'))
      process.exit(1)
    }
    // Show current usage
    try {
      const r = await fetch('https://codexyy.dev/api/free/usage', {
        headers: { Authorization: `Bearer ${auth.token}` }
      })
      if (r.ok) {
        const u = await r.json()
        console.log(C.dim(`  Usage this week: `) + C.accent(`${u.used}/${u.limit}`) + C.dim(' messages\n'))
      }
    } catch {}

    // Model selection
    console.log('  ' + C.bold('Which model?') + C.dim('  (30 msgs/week, enter to use default)\n'))
    const cfModels = await fetchHostedModels(auth?.user?.plan || 'free')
    cfModels.forEach((m, i) => {
      const isDefault = i === 0
      const tag = isDefault ? C.accent(`[${m.tag}]`) : C.dim(`[${m.tag}]`)
      console.log(`  ${C.accent(i + 1 + '.')} ${m.label.padEnd(26)} ${tag}`)
    })
    const mc = await ask(C.dim(`\n  Enter 1-${cfModels.length} (default 1): `))
    const mi = parseInt(mc) - 1
    cfg.model = (mi >= 0 && mi < cfModels.length) ? cfModels[mi].id : cfModels[0].id
    console.log()
  }

  if (provider.id === 'openrouter') {
    const envKey = process.env.OPENROUTER_API_KEY
    if (envKey) {
      console.log(C.dim('  Using OPENROUTER_API_KEY from environment.\n'))
      cfg.openrouter_key = envKey
    } else {
      console.log(C.dim('  Get a free key at openrouter.ai/keys'))
      const key = await ask('  Paste your OpenRouter key: ')
      if (!key) { console.log(C.err('  No key provided. Exiting.')); process.exit(1) }
      cfg.openrouter_key = key
    }

    console.log('\n  ' + C.bold('Which model?') + C.dim('  (enter to use default)\n'))
    const models = [
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet',  tag: 'recommended' },
      { id: 'anthropic/claude-3.5-haiku',  label: 'Claude 3.5 Haiku',   tag: 'fastest' },
      { id: 'anthropic/claude-3-opus',     label: 'Claude 3 Opus',      tag: 'most capable' },
      { id: 'openai/gpt-4o',              label: 'GPT-4o',              tag: 'fast' },
      { id: 'openai/gpt-4o-mini',         label: 'GPT-4o mini',         tag: 'cheapest' },
      { id: 'deepseek/deepseek-r1',       label: 'DeepSeek R1',         tag: 'reasoning' },
      { id: 'google/gemini-flash-1.5',    label: 'Gemini Flash 1.5',    tag: 'multimodal' },
    ]
    models.forEach((m, i) => {
      const isDefault = m.id === provider.defaultModel
      const tag = isDefault ? C.accent(`[${m.tag}]`) : C.dim(`[${m.tag}]`)
      console.log(`  ${C.accent(i + 1 + '.')} ${m.label.padEnd(26)} ${tag}`)
    })
    const mc = await ask(C.dim(`\n  Enter 1-${models.length} or model ID (default 1): `))
    const mi = parseInt(mc) - 1
    if (mi >= 0 && mi < models.length) cfg.model = models[mi].id
    else if (mc && !parseInt(mc)) cfg.model = mc  // raw model ID
    console.log()
  }

  saveConfig(cfg)
  console.log(C.accent('  Setup complete.') + C.dim(' Config saved to ~/.config/codexyy/config.json\n'))
  return cfg
}
