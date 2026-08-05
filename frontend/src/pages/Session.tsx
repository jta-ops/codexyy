import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from '../router'
import styles from './Session.module.css'

type FileNode = { name: string; type: 'file' | 'dir'; path: string; children?: FileNode[] }
type Message = { role: 'user' | 'ai'; content: string; ts: number }
type TermLine = { text: string; done?: boolean }

let msgId = 0
const nextId = () => `r${++msgId}`

const ANTHROPIC_MODELS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-7']
const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
const OLLAMA_MODELS = ['llama3', 'llama3.1', 'qwen2.5', 'qwen2.5-coder', 'codestral', 'mistral', 'deepseek-coder', 'phi3']

function ls(key: string, fallback = '') { return localStorage.getItem(key) || fallback }
function lset(key: string, val: string) { localStorage.setItem(key, val) }

export default function Session() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const ws = useRef<WebSocket | null>(null)
  const pending = useRef<Record<string, (data: any) => void>>({})

  const [connected, setConnected] = useState(false)
  const [cwd, setCwd] = useState('')
  const [tree, setTree] = useState<FileNode | null>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [termLines, setTermLines] = useState<TermLine[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Provider settings
  const [provider, setProvider] = useState(() => ls('cx_provider', 'anthropic'))
  const [apiKey, setApiKey] = useState(() => ls('cx_key'))
  const [model, setModel] = useState(() => ls('cx_model', 'claude-haiku-4-5'))
  const [ollamaModel, setOllamaModel] = useState(() => ls('cx_ollama_model', 'llama3'))
  const [ollamaCustom, setOllamaCustom] = useState(() => ls('cx_ollama_custom'))
  const [compatUrl, setCompatUrl] = useState(() => ls('cx_compat_url', 'https://openrouter.ai/api/v1'))
  const [compatKey, setCompatKey] = useState(() => ls('cx_compat_key'))
  const [compatModel, setCompatModel] = useState(() => ls('cx_compat_model', 'openai/gpt-4o'))

  const chatBottom = useRef<HTMLDivElement>(null)

  const send = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  const request = useCallback(<T = any>(msg: object): Promise<T> => {
    return new Promise((resolve) => {
      const id = nextId()
      pending.current[id] = resolve
      send({ ...msg, id })
    })
  }, [send])

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${window.location.host}/relay/${sessionId}?client_type=browser`)
    ws.current = socket

    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      const res = pending.current[msg.id]
      if (res) { res(msg); delete pending.current[msg.id] }

      if (msg.type === 'cli.connected') {
        setConnected(true)
        setCwd(msg.cwd || '')
        request({ type: 'fs.list', path: msg.cwd }).then((r: any) => setTree(r.data))
      }
      if (msg.type === 'cli.disconnected') setConnected(false)
      if (msg.type === 'shell.output') {
        setTermLines(prev => {
          const next = [...prev]
          if (msg.chunk) next.push({ text: msg.chunk })
          if (msg.done) next.push({ text: '', done: true })
          return next.slice(-300)
        })
      }
    }

    socket.onclose = () => setConnected(false)
    return () => socket.close()
  }, [sessionId])

  useEffect(() => { chatBottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const openFile = async (path: string) => {
    setActiveFile(path)
    const r: any = await request({ type: 'fs.read', path })
    setFileContent(r.content)
  }

  const runCommand = (cmd: string) => {
    setTermLines(prev => [...prev, { text: `$ ${cmd}\n` }])
    send({ type: 'shell.run', cmd, id: nextId() })
  }

  const buildContext = () => activeFile && fileContent
    ? `Current file: ${activeFile}\n\`\`\`\n${fileContent.slice(0, 4000)}\n\`\`\`\n\n`
    : cwd ? `Project: ${cwd}\n\n` : ''

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || aiLoading) return
    setInput('')
    const history = [...messages, { role: 'user' as const, content: text, ts: Date.now() }]
    setMessages(history)
    setAiLoading(true)

    try {
      const context = buildContext()
      const sysPrompt = `You are codexyy, an AI coding assistant. ${context}`
      let reply = ''

      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-calls': 'true',
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: sysPrompt,
            messages: history.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
          }),
        })
        const d = await res.json()
        reply = d.content?.[0]?.text || d.error?.message || 'No response'

      } else if (provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: sysPrompt },
              ...history.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
            ],
          }),
        })
        const d = await res.json()
        reply = d.choices?.[0]?.message?.content || d.error?.message || 'No response'

      } else if (provider === 'ollama') {
        const m = ollamaCustom.trim() || ollamaModel
        // Run via CLI relay since Ollama is on the user's machine
        const prompt = [...history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`), `User: ${text}`].join('\n') + '\nAssistant:'
        const escaped = prompt.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/"/g, '\\"')
        const r: any = await request({
          type: 'shell.run',
          cmd: `curl -sf http://localhost:11434/api/generate -d '{"model":"${m}","prompt":"${escaped}","stream":false}' 2>&1`,
        })
        try { reply = JSON.parse(r.chunk || '{}').response || 'no response from ollama' }
        catch { reply = r.chunk?.includes('refused') ? 'Ollama not running on your machine' : 'Ollama parse error' }

      } else if (provider === 'compat') {
        // OpenAI-compatible: OpenRouter, Groq, LM Studio, Together, etc.
        const res = await fetch(`${compatUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${compatKey}`,
            'content-type': 'application/json',
            'HTTP-Referer': 'https://codexyy.dev',
          },
          body: JSON.stringify({
            model: compatModel,
            messages: [
              { role: 'system', content: sysPrompt },
              ...history.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
            ],
          }),
        })
        const d = await res.json()
        reply = d.choices?.[0]?.message?.content || d.error?.message || 'No response'
      } else {
        reply = 'Configure a provider in settings.'
      }

      setMessages(prev => [...prev, { role: 'ai', content: reply, ts: Date.now() }])
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'ai', content: `Error: ${err.message}`, ts: Date.now() }])
    } finally {
      setAiLoading(false)
    }
  }

  const saveProvider = (p: string) => { setProvider(p); lset('cx_provider', p) }
  const saveKey = (k: string) => { setApiKey(k); lset('cx_key', k) }
  const saveModel = (m: string) => { setModel(m); lset('cx_model', m) }
  const saveOllamaModel = (m: string) => { setOllamaModel(m); lset('cx_ollama_model', m) }
  const saveOllamaCustom = (m: string) => { setOllamaCustom(m); lset('cx_ollama_custom', m) }
  const saveCompatUrl = (u: string) => { setCompatUrl(u); lset('cx_compat_url', u) }
  const saveCompatKey = (k: string) => { setCompatKey(k); lset('cx_compat_key', k) }
  const saveCompatModel = (m: string) => { setCompatModel(m); lset('cx_compat_model', m) }

  return (
    <div className={styles.app}>
      <div className={styles.topbar}>
        <div className={styles.topLeft}>
          <span className={styles.logo}>codexyy</span>
          {cwd && <span className={styles.cwd}>{cwd.split('/').pop()}</span>}
        </div>
        <div className={styles.topRight}>
          <div className={`${styles.status} ${connected ? styles.online : styles.offline}`}>
            <span className={styles.statusDot} />
            {connected ? 'connected' : 'waiting for CLI'}
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        {/* File tree */}
        <div className={styles.sidebar}>
          <div className={styles.panelHead}>Files</div>
          {tree
            ? <TreeNode node={tree} onOpen={openFile} active={activeFile} depth={0} />
            : <div className={styles.empty}>{connected ? 'loading...' : 'run codexyy in your project'}</div>
          }
        </div>

        {/* Editor */}
        <div className={styles.editor}>
          <div className={styles.panelHead}>{activeFile ? activeFile.split('/').pop() : 'select a file'}</div>
          {fileContent
            ? <pre className={styles.code}><code>{fileContent}</code></pre>
            : <div className={styles.empty}>click a file to view it</div>
          }
        </div>

        {/* Right: chat + terminal */}
        <div className={styles.right}>
          <div className={styles.chat}>
            <div className={styles.panelHead}>
              AI Chat
              <button className={styles.settingsBtn} onClick={() => setShowSettings(s => !s)} title="Settings">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {showSettings && (
              <div className={styles.settings}>
                <div className={styles.settingRow}>
                  <label htmlFor="session-provider">Provider</label>
                  <select id="session-provider" value={provider} onChange={e => saveProvider(e.target.value)} className={styles.select}>
                    <option value="anthropic">Anthropic Claude</option>
                    <option value="openai">OpenAI</option>
                    <option value="ollama">Ollama (local)</option>
                    <option value="compat">OpenAI-compatible</option>
                  </select>
                </div>

                {provider === 'anthropic' && <>
                  <div className={styles.settingRow}>
                    <label htmlFor="anthropic-key">API Key</label>
                    <input id="anthropic-key" type="password" value={apiKey} onChange={e => saveKey(e.target.value)} placeholder="sk-ant-..." className={styles.settingInput} />
                  </div>
                  <div className={styles.settingRow}>
                    <label htmlFor="anthropic-model">Model</label>
                    <select id="anthropic-model" value={model} onChange={e => saveModel(e.target.value)} className={styles.select}>
                      {ANTHROPIC_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </>}

                {provider === 'openai' && <>
                  <div className={styles.settingRow}>
                    <label htmlFor="openai-key">API Key</label>
                    <input id="openai-key" type="password" value={apiKey} onChange={e => saveKey(e.target.value)} placeholder="sk-..." className={styles.settingInput} />
                  </div>
                  <div className={styles.settingRow}>
                    <label htmlFor="openai-model">Model</label>
                    <select id="openai-model" value={model} onChange={e => saveModel(e.target.value)} className={styles.select}>
                      {OPENAI_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </>}

                {provider === 'ollama' && <>
                  <div className={styles.settingRow}>
                    <label htmlFor="ollama-model">Model</label>
                    <select id="ollama-model" value={ollamaModel} onChange={e => saveOllamaModel(e.target.value)} className={styles.select}>
                      {OLLAMA_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className={styles.settingRow}>
                    <label htmlFor="ollama-custom">Custom model</label>
                    <input id="ollama-custom" value={ollamaCustom} onChange={e => saveOllamaCustom(e.target.value)} placeholder="overrides above" className={styles.settingInput} />
                  </div>
                </>}

                {provider === 'compat' && <>
                  <div className={styles.settingRow}>
                    <label htmlFor="compat-url">Base URL</label>
                    <input id="compat-url" value={compatUrl} onChange={e => saveCompatUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" className={styles.settingInput} />
                  </div>
                  <div className={styles.settingRow}>
                    <label htmlFor="compat-key">API Key</label>
                    <input id="compat-key" type="password" value={compatKey} onChange={e => saveCompatKey(e.target.value)} placeholder="sk-..." className={styles.settingInput} />
                  </div>
                  <div className={styles.settingRow}>
                    <label htmlFor="compat-model">Model</label>
                    <input id="compat-model" value={compatModel} onChange={e => saveCompatModel(e.target.value)} placeholder="openai/gpt-4o" className={styles.settingInput} />
                  </div>
                  <div className={styles.settingHint}>Works with OpenRouter, Groq, LM Studio, Together AI, and any OpenAI-compatible API.</div>
                </>}
              </div>
            )}

            <div className={styles.messages}>
              {messages.length === 0 && <div className={styles.chatEmpty}>ask anything about your code</div>}
              {messages.map((m, i) => (
                <div key={i} className={`${styles.msg} ${m.role === 'user' ? styles.userMsg : styles.aiMsg}`}>
                  <span className={styles.msgRole}>{m.role === 'user' ? 'you' : 'ai'}</span>
                  <span className={styles.msgText}>{m.content}</span>
                </div>
              ))}
              {aiLoading && (
                <div className={`${styles.msg} ${styles.aiMsg}`}>
                  <span className={styles.msgRole}>ai</span>
                  <span className={styles.thinking}>thinking...</span>
                </div>
              )}
              <div ref={chatBottom} />
            </div>

            <div className={styles.inputWrap}>
              <textarea
                className={styles.input}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="ask anything..."
                rows={1}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              />
              <button onClick={sendMessage} disabled={aiLoading} className={styles.sendBtn}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7h12M7 1l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          <div className={styles.terminal}>
            <div className={styles.panelHead}>
              Terminal
              <button className={styles.clearBtn} onClick={() => setTermLines([])}>clear</button>
            </div>
            <div className={styles.termOutput}>
              {termLines.length === 0 && <span className={styles.empty}>no output yet</span>}
              {termLines.map((l, i) => (
                l.done
                  ? <span key={i} className={styles.termDone}>---</span>
                  : <span key={i} className={styles.termLine}>{l.text}</span>
              ))}
            </div>
            <div className={styles.termInputWrap}>
              <span className={styles.termPrompt}>$</span>
              <input
                className={styles.termInput}
                placeholder="run a command..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim()
                    if (val) { runCommand(val); (e.target as HTMLInputElement).value = '' }
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TreeNode({ node, onOpen, active, depth }: { node: FileNode; onOpen: (p: string) => void; active: string | null; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const isActive = node.path === active

  if (node.type === 'file') {
    return (
      <div
        className={`${styles.treeFile} ${isActive ? styles.treeActive : ''}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => onOpen(node.path)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onOpen(node.path) }}
        role="button"
        tabIndex={0}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
          <path d="M2 1.5h5.5l2.5 2.5V10.5H2V1.5z" stroke="currentColor" strokeWidth="1" fill="none"/>
        </svg>
        {node.name}
      </div>
    )
  }

  return (
    <div>
      <div className={styles.treeDir} style={{ paddingLeft: `${12 + depth * 14}px` }} onClick={() => setOpen(o => !o)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setOpen(o => !o) }} role="button" tabIndex={0} aria-expanded={open}>
        <span className={styles.treeCaret}>{open ? '▾' : '▸'}</span>
        {node.name}
      </div>
      {open && node.children?.map(c => (
        <TreeNode key={c.path} node={c} onOpen={onOpen} active={active} depth={depth + 1} />
      ))}
    </div>
  )
}
