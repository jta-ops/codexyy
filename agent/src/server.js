import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, relative, dirname, extname, resolve, sep } from 'path'
import { execSync } from 'child_process'
import { promisify } from 'util'
import { exec } from 'child_process'

const execAsync = promisify(exec)

const IGNORE = new Set(['.git','node_modules','__pycache__','.venv','dist','build','.next','coverage'])

const MIME = {
  '.js': 'application/javascript', '.ts': 'application/typescript',
  '.json': 'application/json', '.html': 'text/html', '.css': 'text/css',
  '.md': 'text/markdown', '.py': 'text/plain', '.sh': 'text/plain',
  '.txt': 'text/plain', '.tsx': 'text/plain', '.jsx': 'text/plain',
  '.go': 'text/plain', '.rs': 'text/plain', '.java': 'text/plain',
  '.c': 'text/plain', '.cpp': 'text/plain', '.h': 'text/plain',
}

function walkDir(dir, depth=0, max=3) {
  if (depth>max) return []
  const entries=[]
  try {
    for (const name of readdirSync(dir).sort()) {
      if (IGNORE.has(name)) continue
      const full=join(dir,name)
      const stat=statSync(full)
      if (stat.isDirectory()) {
        entries.push({type:'dir',name,path:full,children:walkDir(full,depth+1,max)})
      } else {
        entries.push({type:'file',name,path:full,size:stat.size})
      }
    }
  } catch {}
  return entries
}

export function startOnlineServer(cwd, port=0, onChat=null) {
  const projectRoot = resolve(cwd)
  const projectPath = candidate => {
    const absolute = resolve(projectRoot, String(candidate || ''))
    if (absolute !== projectRoot && !absolute.startsWith(projectRoot + sep)) return null
    return absolute
  }
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set()
  const termLog = []

  wss.on('connection', ws => {
    clients.add(ws)
    // Send buffered terminal output on connect
    if (termLog.length) ws.send(JSON.stringify({ type:'term_history', lines:termLog }))
    ws.on('close', () => clients.delete(ws))
    ws.on('message', async raw => {
      try {
        const msg = JSON.parse(raw)
        if (msg.type === 'chat' && onChat) {
          onChat(msg.text)
        } else if (msg.type === 'run') {
          broadcast({ type:'term', text:`$ ${msg.cmd}\n`, color:'dim' })
          try {
            const { stdout, stderr } = await execAsync(msg.cmd, { cwd, timeout:30000 })
            if (stdout) broadcast({ type:'term', text:stdout, color:'out' })
            if (stderr) broadcast({ type:'term', text:stderr, color:'err' })
          } catch (e) {
            broadcast({ type:'term', text:(e.stderr||e.message)+'\n', color:'err' })
          }
        }
      } catch {}
    })
  })

  function broadcast(msg) {
    const s = JSON.stringify(msg)
    if (msg.type==='term') termLog.push(msg)
    for (const c of clients) {
      try { c.send(s) } catch {}
    }
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const p = url.pathname

    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'")

    if (p === '/' || p === '/index.html') {
      res.setHeader('Content-Type','text/html')
      res.end(getUI())
      return
    }

    if (p === '/api/tree') {
      res.setHeader('Content-Type','application/json')
      res.end(JSON.stringify(walkDir(cwd)))
      return
    }

    if (p === '/api/file' && req.method==='GET') {
      const file = projectPath(url.searchParams.get('path'))
      if (!file) { res.writeHead(403); res.end('Path is outside the workspace'); return }
      if (!existsSync(file)) { res.writeHead(404); res.end('Not found'); return }
      try {
        const content = readFileSync(file,'utf8')
        const ext = extname(file)
        res.setHeader('Content-Type', MIME[ext]||'text/plain')
        res.end(content)
      } catch(e) { res.writeHead(500); res.end(e.message) }
      return
    }

    if (p === '/api/file' && req.method==='POST') {
      let body=''
      req.on('data',d=>body+=d)
      req.on('end',()=>{
        try {
          const { path:fp, content } = JSON.parse(body)
          const file = projectPath(fp)
          if (!file) { res.writeHead(403); res.end('Path is outside the workspace'); return }
          mkdirSync(dirname(file),{recursive:true})
          writeFileSync(file,content,'utf8')
          broadcast({type:'file_saved',path:file})
          res.setHeader('Content-Type','application/json')
          res.end(JSON.stringify({ok:true}))
        } catch(e) { res.writeHead(500); res.end(e.message) }
      })
      return
    }

    res.writeHead(404); res.end('Not found')
  })

  server.on('upgrade', (req, socket, head) => {
    try {
      const origin = req.headers.origin ? new URL(req.headers.origin) : null
      if (origin && origin.host !== req.headers.host) { socket.destroy(); return }
    } catch { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port
      resolve({ server, broadcast, port: actualPort })
    })
  })
}

// Called by the agent to pipe output to browser clients
export function createBroadcaster(broadcast) {
  return {
    term: (text, color='out') => broadcast({ type:'term', text, color }),
    toolCall: (name, args) => broadcast({ type:'tool_call', name, args:JSON.stringify(args).slice(0,120) }),
    toolResult: (name, ok) => broadcast({ type:'tool_result', name, ok }),
    aiChunk: (text) => broadcast({ type:'ai_chunk', text }),
    userMsg: (text) => broadcast({ type:'user_msg', text }),
  }
}

function getUI() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>codexyy --online</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07070a;--bg2:#0e0e14;--bg3:#141420;
  --border:#1a1a26;--b2:#252535;
  --accent:#4effa8;--t2:#7878a0;--t3:#3a3a52;
  --text:#e2e2ec;
  --mono:'JetBrains Mono',monospace;
  --display:'Syne',sans-serif;
}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;display:flex;flex-direction:column}

/* Top bar */
.bar{height:48px;background:var(--bg3);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:12px;flex-shrink:0}
.bar-logo{font-family:var(--display);font-size:15px;font-weight:800;color:var(--text)}
.bar-logo span{color:var(--accent)}
.bar-cwd{font-size:11px;color:var(--t3);margin-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-status{margin-left:auto;font-size:11px;display:flex;align-items:center;gap:6px;color:var(--t2)}
.dot-live{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* Layout */
.layout{flex:1;display:grid;grid-template-columns:220px 1fr 340px;overflow:hidden}

/* Sidebar */
.sidebar{background:var(--bg);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.panel-head{padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);border-bottom:1px solid var(--border);flex-shrink:0}
.file-tree{flex:1;overflow-y:auto;padding:8px 0}
.file-tree::-webkit-scrollbar{width:4px}
.file-tree::-webkit-scrollbar-thumb{background:var(--b2)}
.fi{display:flex;align-items:center;gap:6px;padding:4px 12px;cursor:pointer;color:var(--t2);white-space:nowrap;font-size:12px;transition:background .1s,color .1s}
.fi:hover{background:var(--bg2);color:var(--text)}
.fi.active{background:rgba(78,255,168,.07);color:var(--accent)}
.fi-icon{flex-shrink:0;color:var(--t3)}

/* Editor area */
.editor-area{display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--border)}
.editor-tabs{height:36px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;overflow:hidden;flex-shrink:0}
.tab{padding:0 14px;height:100%;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t3);cursor:pointer;border-right:1px solid var(--border);white-space:nowrap;transition:background .15s,color .15s}
.tab.active{background:var(--bg);color:var(--text)}
.tab-close{color:var(--t3);padding:0 2px;transition:color .15s}
.tab:hover .tab-close{color:var(--t2)}
.editor-content{flex:1;overflow:auto;position:relative}
.editor-content::-webkit-scrollbar{width:6px;height:6px}
.editor-content::-webkit-scrollbar-thumb{background:var(--b2)}
#editor{width:100%;height:100%;background:transparent;border:none;outline:none;color:var(--text);font-family:var(--mono);font-size:13px;line-height:1.7;padding:16px 20px;resize:none;caret-color:var(--accent)}
.editor-save{position:absolute;bottom:12px;right:12px;background:var(--accent);color:#07070a;border:none;padding:6px 14px;border-radius:7px;font-family:var(--mono);font-size:12px;font-weight:700;cursor:pointer;opacity:0;transition:opacity .2s}
.editor-save.visible{opacity:1}
.editor-empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--t3);font-size:13px;flex-direction:column;gap:8px}

/* Right panel - term + chat */
.right-panel{display:flex;flex-direction:column;overflow:hidden}
.term-section{flex:1;display:flex;flex-direction:column;min-height:0;border-bottom:1px solid var(--border)}
.term-out{flex:1;overflow-y:auto;padding:12px 14px;line-height:1.7}
.term-out::-webkit-scrollbar{width:4px}
.term-out::-webkit-scrollbar-thumb{background:var(--b2)}
.term-line{white-space:pre-wrap;word-break:break-all;font-size:12px}
.tc-dim{color:var(--t3)}.tc-out{color:var(--text)}.tc-err{color:#f87171}.tc-ai{color:var(--accent)}.tc-user{color:#7dd3fc}.tc-tool{color:#fbbf24}
.term-input-row{display:flex;align-items:center;gap:0;border-top:1px solid var(--border);flex-shrink:0;height:36px}
.term-prompt{color:var(--accent);padding:0 10px;flex-shrink:0;font-size:12px}
#termInput{flex:1;background:none;border:none;outline:none;color:var(--text);font-family:var(--mono);font-size:12px;padding:0}

.chat-section{height:280px;display:flex;flex-direction:column;flex-shrink:0}
.chat-msgs{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.chat-msgs::-webkit-scrollbar{width:4px}
.chat-msgs::-webkit-scrollbar-thumb{background:var(--b2)}
.msg{font-size:12px;line-height:1.6;padding:8px 10px;border-radius:8px}
.msg-user{background:rgba(125,211,252,.07);color:#7dd3fc;align-self:flex-end;max-width:90%}
.msg-ai{background:rgba(78,255,168,.06);color:var(--accent);align-self:flex-start;max-width:100%}
.msg-tool{background:rgba(251,191,36,.05);color:#fbbf24;font-size:11px;align-self:flex-start}
.chat-input-row{display:flex;align-items:center;border-top:1px solid var(--border);flex-shrink:0;height:40px}
.chat-prefix{color:var(--t3);padding:0 10px;font-size:11px;flex-shrink:0}
#chatInput{flex:1;background:none;border:none;outline:none;color:var(--text);font-family:var(--mono);font-size:12px;padding:0}
.chat-send{background:none;border:none;padding:0 12px;color:var(--t3);cursor:pointer;height:100%;transition:color .15s}
.chat-send:hover{color:var(--accent)}
</style>
</head>
<body>

<div class="bar">
  <span class="bar-logo">codexyy<span>.dev</span></span>
  <span class="bar-cwd" id="barCwd">loading...</span>
  <div class="bar-status"><span class="dot-live"></span>online</div>
</div>

<div class="layout">
  <!-- Sidebar -->
  <div class="sidebar">
    <div class="panel-head">Explorer</div>
    <div class="file-tree" id="fileTree">Loading...</div>
  </div>

  <!-- Editor -->
  <div class="editor-area">
    <div class="editor-tabs" id="tabs"></div>
    <div class="editor-content">
      <div class="editor-empty" id="editorEmpty">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M8 6h10l6 6v14a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2z" stroke="#3a3a52" stroke-width="1.5"/><path d="M18 6v8h8" stroke="#3a3a52" stroke-width="1.5"/></svg>
        Select a file to edit
      </div>
      <textarea id="editor" style="display:none" spellcheck="false"></textarea>
      <button class="editor-save" id="saveBtn" onclick="saveFile()">Save</button>
    </div>
  </div>

  <!-- Right panel -->
  <div class="right-panel">
    <div class="term-section">
      <div class="panel-head">Terminal</div>
      <div class="term-out" id="termOut"></div>
      <div class="term-input-row">
        <span class="term-prompt">$</span>
        <input id="termInput" placeholder="run a command..." autocomplete="off">
      </div>
    </div>
    <div class="chat-section">
      <div class="panel-head">AI Chat</div>
      <div class="chat-msgs" id="chatMsgs"></div>
      <div class="chat-input-row">
        <span class="chat-prefix">you &gt;</span>
        <input id="chatInput" placeholder="ask the AI anything..." autocomplete="off">
        <button class="chat-send" onclick="sendChat()">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
  </div>
</div>

<script>
const ws = new WebSocket('ws://'+location.host)
let currentFile = null
let tabs = {}
let currentTab = null
let aiBuffer = ''
let aiMsgEl = null

ws.onmessage = e => {
  const msg = JSON.parse(e.data)
  if (msg.type==='term'||msg.type==='term_history') {
    const lines = msg.type==='term_history' ? msg.lines : [msg]
    lines.forEach(m => appendTerm(m.text, m.color))
  }
  if (msg.type==='tool_call') appendChat(\`- \${msg.name}(\${msg.args})\`,'tool')
  if (msg.type==='ai_chunk') {
    aiBuffer += msg.text
    if (!aiMsgEl) { aiMsgEl = appendChat('','ai',true); }
    aiMsgEl.textContent = aiBuffer
    scrollChat()
  }
  if (msg.type==='user_msg') { appendChat(msg.text,'user'); aiBuffer=''; aiMsgEl=null; }
  if (msg.type==='file_saved') { if(tabs[msg.path]) tabs[msg.path].dirty=false; renderTabs() }
}

function appendTerm(text,color='out'){
  const el=document.createElement('div')
  el.className='term-line tc-'+color
  el.textContent=text
  const out=document.getElementById('termOut')
  out.appendChild(el)
  out.scrollTop=out.scrollHeight
}

function appendChat(text,role,returnEl=false){
  const el=document.createElement('div')
  el.className='msg msg-'+role
  el.textContent=text
  const msgs=document.getElementById('chatMsgs')
  msgs.appendChild(el)
  if(returnEl)return el
  scrollChat()
}
function scrollChat(){const m=document.getElementById('chatMsgs');m.scrollTop=m.scrollHeight}

// File tree
async function loadTree(){
  const res=await fetch('/api/tree')
  const tree=await res.json()
  const el=document.getElementById('fileTree')
  el.innerHTML=''
  renderTree(tree,el,0)
}

function renderTree(nodes,parent,depth){
  for(const n of nodes){
    const el=document.createElement('div')
    el.className='fi'
    el.style.paddingLeft=(12+depth*14)+'px'
    if(n.type==='dir'){
      el.innerHTML=\`<span class="fi-icon">&#9656;</span><span>\${n.name}/</span>\`
      parent.appendChild(el)
      const sub=document.createElement('div')
      sub.id='dir-'+btoa(n.path)
      sub.style.display='none'
      parent.appendChild(sub)
      el.addEventListener('click',()=>{
        const s=document.getElementById('dir-'+btoa(n.path))
        if(s.style.display==='none'){s.style.display='';renderTree(n.children,s,depth+1)}
        else{s.style.display='none';s.innerHTML=''}
      })
    } else {
      el.innerHTML=\`<span class="fi-icon">&#9632;</span><span>\${n.name}</span>\`
      el.addEventListener('click',()=>openFile(n.path,n.name))
      parent.appendChild(el)
    }
  }
}

async function openFile(path,name){
  if(tabs[path]){setActive(path);return}
  const res=await fetch('/api/file?path='+encodeURIComponent(path))
  const content=await res.text()
  tabs[path]={name,content,dirty:false}
  setActive(path)
}

function setActive(path){
  currentTab=path
  renderTabs()
  const t=tabs[path]
  const editor=document.getElementById('editor')
  const empty=document.getElementById('editorEmpty')
  editor.style.display='block'
  empty.style.display='none'
  editor.value=t.content
  editor.oninput=()=>{tabs[path].dirty=true;renderTabs();document.getElementById('saveBtn').classList.add('visible')}
}

function renderTabs(){
  const bar=document.getElementById('tabs')
  bar.innerHTML=''
  for(const [path,t] of Object.entries(tabs)){
    const el=document.createElement('div')
    el.className='tab'+(path===currentTab?' active':'')
    el.innerHTML=\`<span>\${t.name}\${t.dirty?'&nbsp;&#9679;':''}</span><span class="tab-close" data-path="\${path}" onclick="closeTab(event,'\${path}')">&#215;</span>\`
    el.addEventListener('click',()=>setActive(path))
    bar.appendChild(el)
  }
}

function closeTab(e,path){
  e.stopPropagation()
  delete tabs[path]
  if(currentTab===path){
    const keys=Object.keys(tabs)
    if(keys.length){setActive(keys[keys.length-1])}
    else{
      currentTab=null
      document.getElementById('editor').style.display='none'
      document.getElementById('editorEmpty').style.display='flex'
      document.getElementById('saveBtn').classList.remove('visible')
    }
  }
  renderTabs()
}

async function saveFile(){
  if(!currentTab)return
  const content=document.getElementById('editor').value
  await fetch('/api/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:currentTab,content})})
  tabs[currentTab].content=content
  tabs[currentTab].dirty=false
  renderTabs()
  document.getElementById('saveBtn').classList.remove('visible')
}

// Terminal input
document.getElementById('termInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const v=e.target.value.trim()
    if(!v)return
    ws.send(JSON.stringify({type:'run',cmd:v}))
    e.target.value=''
  }
})

// Chat
function sendChat(){
  const input=document.getElementById('chatInput')
  const v=input.value.trim()
  if(!v)return
  ws.send(JSON.stringify({type:'chat',text:v}))
  appendChat(v,'user')
  aiBuffer='';aiMsgEl=null
  input.value=''
}
document.getElementById('chatInput').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}
})

// Init
document.getElementById('barCwd').textContent=location.hostname+':'+location.port
loadTree()
</script>
</body>
</html>`
}
