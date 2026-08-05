import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { toolDefs, toolHandlers } from './tools.js'
import renderer from './renderer.js'
import { loadAuth } from './auth.js'

const { printAIStart, printAI, printAIEnd, printToolCall, printToolResult } =
  new Proxy({}, { get: (_, k) => (...a) => renderer[k]?.(...a) })

const DEFAULT_SYSTEM = `You are codexyy, an expert AI coding agent running in the terminal.

Rules:
- Always read files before editing them
- Prefer replace_in_file for targeted edits; use write_file only for new files or full rewrites
- After any code change, run the relevant test/lint/build command to verify it works
- If a bash command fails, read the error, fix the root cause, and rerun — don't stop at the first failure
- For multi-step tasks, briefly state your plan (files to change, approach) before starting
- Follow existing code style — indentation, naming, patterns in the file
- Be direct and concise. No filler phrases like "Certainly!" or "Of course!"
- Use git tools to check status/diff when working in a repo
- Never modify test files unless explicitly asked`

// OpenAI-compatible tool format (used for OpenAI, Ollama, codexyy-hosted)
const oaiTools = toolDefs.map(t => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }
}))

export const PROVIDER_MODELS = {
  codexyy: [
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',     label: 'Llama 3.3 70B',       tag: 'default · fast + smart', tier: 'free', context_window: 24000 },
    { id: '@cf/qwen/qwen2.5-coder-32b-instruct',          label: 'Qwen 2.5 Coder 32B',  tag: 'great for code', tier: 'free', context_window: 32000 },
    { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 32B',      tag: 'reasoning', tier: 'free', context_window: 32000 },
    { id: '@cf/meta/llama-3.1-8b-instruct',               label: 'Llama 3.1 8B',        tag: 'fastest', tier: 'free', context_window: 24000 },
    { id: '@cf/mistral/mistral-7b-instruct-v0.1',         label: 'Mistral 7B',          tag: 'lightweight', tier: 'free', context_window: 24000 },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tag: 'recommended' },
    { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7',   tag: 'most capable' },
    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  tag: 'fastest' },
  ],
  openai: [
    { id: 'gpt-4o',       label: 'GPT-4o',      tag: 'recommended' },
    { id: 'gpt-4o-mini',  label: 'GPT-4o mini', tag: 'faster' },
    { id: 'o3-mini',      label: 'o3-mini',      tag: 'reasoning' },
    { id: 'o1',           label: 'o1',           tag: 'slow reasoning' },
  ],
  openrouter: [
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet',  tag: 'recommended' },
    { id: 'anthropic/claude-3.5-haiku',  label: 'Claude 3.5 Haiku',   tag: 'fastest' },
    { id: 'anthropic/claude-3-opus',     label: 'Claude 3 Opus',      tag: 'most capable' },
    { id: 'openai/gpt-4o',              label: 'GPT-4o',              tag: 'fast' },
    { id: 'openai/gpt-4o-mini',         label: 'GPT-4o mini',         tag: 'cheapest' },
    { id: 'deepseek/deepseek-r1',       label: 'DeepSeek R1',         tag: 'reasoning' },
    { id: 'google/gemini-flash-1.5',    label: 'Gemini Flash 1.5',    tag: 'multimodal' },
  ],
  ollama: [], // populated dynamically
}

export async function fetchHostedModels(plan = 'free') {
  try {
    const response = await fetch('https://codexyy.dev/api/models', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`model catalog returned ${response.status}`)
    const data = await response.json()
    const allowPro = plan === 'pro' || plan === 'pro_max'
    const models = (data.models || []).filter(model => model.tier === 'free' || allowPro)
    if (models.length) PROVIDER_MODELS.codexyy = models
  } catch {}
  return PROVIDER_MODELS.codexyy.filter(model => model.tier !== 'pro' || plan === 'pro' || plan === 'pro_max')
}

export class Agent {
  constructor(cfg, customPrompt = null) {
    this.cfg = cfg
    this.provider = cfg.provider || 'anthropic'
    this.model = cfg.model || 'claude-sonnet-4-6'
    this.history = []
    this.usage = { input: 0, output: 0, model: this.model, contextWindow: 0 }
    this.bc = null
    this.system = customPrompt
      ? `${DEFAULT_SYSTEM}\n\n--- User's custom instructions ---\n${customPrompt}`
      : DEFAULT_SYSTEM
    this._buildClient()
  }

  setCustomPrompt(prompt) {
    this.system = prompt
      ? `${DEFAULT_SYSTEM}\n\n--- User's custom instructions ---\n${prompt}`
      : DEFAULT_SYSTEM
  }

  _buildClient() {
    const { provider, api_key, openai_key, codexyy_token, ollama_url, openrouter_key } = this.cfg
    if (provider === 'codexyy') {
      const auth = loadAuth()
      const plan = auth?.user?.plan || 'free'
      this.oai = new OpenAI({
        baseURL: plan === 'pro' || plan === 'pro_max'
          ? 'https://codexyy.dev/api/v1'
          : 'https://codexyy.dev/api/free/v1',
        apiKey: auth?.token || '',
      })
    } else if (provider === 'anthropic') {
      this.anthropic = new Anthropic({ apiKey: api_key || process.env.ANTHROPIC_API_KEY })
    } else if (provider === 'openai') {
      this.oai = new OpenAI({ apiKey: openai_key || process.env.OPENAI_API_KEY })
    } else if (provider === 'ollama') {
      this.oai = new OpenAI({
        baseURL: (ollama_url || 'http://localhost:11434') + '/v1',
        apiKey: 'ollama',
      })
    } else if (provider === 'openrouter') {
      this.oai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: cfg.openrouter_key || process.env.OPENROUTER_API_KEY || '',
        defaultHeaders: { 'HTTP-Referer': 'https://codexyy.dev', 'X-Title': 'codexyy' },
      })
    }
  }

  setBroadcaster(bc) { this.bc = bc }

  clearHistory() { this.history = [] }

  async chat(userMessage) {
    this.history.push({ role: 'user', content: userMessage })
    if (this.bc) this.bc.userMsg(userMessage)
    printAIStart()

    const originalModel = this.model
    const candidates = [originalModel]
    if (this.provider === 'codexyy') {
      const plan = loadAuth()?.user?.plan || 'free'
      const hosted = await fetchHostedModels(plan)
      candidates.push(...hosted.map(model => model.id).filter(id => id !== originalModel).slice(0, 2))
    }
    let lastError
    for (const [index, candidate] of candidates.entries()) {
      this.model = candidate
      this.usage.model = candidate
      this.usage.contextWindow = PROVIDER_MODELS[this.provider]?.find(model => model.id === candidate)?.context_window || 0
      try {
        return this.provider === 'anthropic' ? await this._chatAnthropic() : await this._chatOAI()
      } catch (error) {
        lastError = error
        const status = Number(error?.status || error?.statusCode || 0)
        const message = String(error?.message || '')
        const transient = status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
        const allowanceFailure = /allowance|weekly limit|spend limit/i.test(message)
        if (!transient || allowanceFailure || index === candidates.length - 1) break
        renderer.printInfo(`  Hosted model unavailable; retrying with ${candidates[index + 1]}.`)
      }
    }
    this.model = originalModel
    throw lastError
  }

  // ── Anthropic streaming with tool use ──────────────────────────
  async _chatAnthropic() {
    let fullText = ''
    while (true) {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: this.system,
        tools: toolDefs,
        messages: this.history,
        stream: true,
      })

      let assistantContent = []
      let currentText = ''
      let currentToolUse = null

      for await (const event of response) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            currentText = ''
          } else if (event.content_block.type === 'tool_use') {
            currentToolUse = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, input: '' }
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const chunk = event.delta.text
            currentText += chunk
            fullText += chunk
            printAI(chunk)
            if (this.bc) this.bc.aiChunk(chunk)
          } else if (event.delta.type === 'input_json_delta') {
            currentToolUse.input += event.delta.partial_json
          }
        } else if (event.type === 'content_block_stop') {
          if (currentText) { assistantContent.push({ type: 'text', text: currentText }); currentText = '' }
          if (currentToolUse) {
            currentToolUse.input = JSON.parse(currentToolUse.input || '{}')
            assistantContent.push(currentToolUse)
            currentToolUse = null
          }
        } else if (event.type === 'message_start' && event.message?.usage) {
          const u = event.message.usage
          this.usage.input  += u.input_tokens || 0
        } else if (event.type === 'message_delta' && event.usage) {
          this.usage.output += event.usage.output_tokens || 0
        }
      }

      this.history.push({ role: 'assistant', content: assistantContent })

      const toolUses = assistantContent.filter(b => b.type === 'tool_use')
      if (!toolUses.length) { printAIEnd(); break }

      const toolResults = []
      for (const tu of toolUses) {
        printToolCall(tu.name, tu.input)
        if (this.bc) this.bc.toolCall(tu.name, tu.input)
        const t0 = Date.now()
        const result = await toolHandlers[tu.name]?.(tu.input) ?? { error: `Unknown tool: ${tu.name}` }
        printToolResult(tu.name, result, Date.now() - t0)
        if (this.bc) this.bc.toolResult(tu.name, !result.error)
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) })
      }

      printAIStart()
      this.history.push({ role: 'user', content: toolResults })
    }
    return fullText
  }

  // ── OpenAI-compatible streaming with tool use ──────────────────
  async _chatOAI() {
    let fullText = ''

    // Convert history: Anthropic tool_result -> OAI tool message format
    const messages = [{ role: 'system', content: this.system }, ...this._toOAIHistory()]

    while (true) {
      const stream = await this.oai.chat.completions.create({
        model: this.model,
        messages,
        tools: oaiTools,
        tool_choice: 'auto',
        stream: true,
        max_tokens: 8192,
      })

      let text = ''
      const toolCalls = {}

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (!delta) continue

        if (delta.content) {
          text += delta.content
          fullText += delta.content
          printAI(delta.content)
          if (this.bc) this.bc.aiChunk(delta.content)
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: '', name: '', args: '' }
            const t = toolCalls[tc.index]
            if (tc.id) t.id = tc.id
            if (tc.function?.name) t.name = tc.function.name
            if (tc.function?.arguments) t.args += tc.function.arguments
          }
        }

        if (chunk.usage) {
          this.usage.input  += chunk.usage.prompt_tokens || 0
          this.usage.output += chunk.usage.completion_tokens || 0
        }
      }

      const calls = Object.values(toolCalls)

      if (text) messages.push({ role: 'assistant', content: text, tool_calls: calls.length ? calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })) : undefined })
      else if (calls.length) messages.push({ role: 'assistant', content: null, tool_calls: calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })) })

      if (!calls.length) { printAIEnd(); break }

      for (const tc of calls) {
        let input
        try { input = JSON.parse(tc.args || '{}') } catch { input = {} }
        printToolCall(tc.name, input)
        if (this.bc) this.bc.toolCall(tc.name, input)
        const t0 = Date.now()
        const result = await toolHandlers[tc.name]?.(input) ?? { error: `Unknown tool: ${tc.name}` }
        printToolResult(tc.name, result, Date.now() - t0)
        if (this.bc) this.bc.toolResult(tc.name, !result.error)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
      }

      printAIStart()
    }

    // Sync back to this.history in a simplified way
    this.history.push({ role: 'assistant', content: fullText || '(tool use)' })
    return fullText
  }

  _toOAIHistory() {
    // Simplified: just pass text messages, skip tool_result blocks
    return this.history.map(m => {
      if (typeof m.content === 'string') return m
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      return { role: m.role, content: text || '' }
    }).filter(m => m.content !== '')
  }
}
