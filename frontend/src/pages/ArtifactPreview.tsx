import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './WorkspaceTools.module.css'

type PreviewMode = 'markdown' | 'html' | 'image'

const START_MARKDOWN = `# Release artifact\n\nA safe, local **Markdown preview**.\n\n- Edit this source\n- Review the rendered result\n- Download when it is ready\n\n\`cxy checkpoint create . --name before-edit\``
const START_HTML = `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Preview</title></head>\n<body style="font:16px system-ui;padding:3rem;background:#0b0b11;color:#eee"><h1>Site preview</h1><p>This HTML runs in a sandbox without scripts or access to Codexyy.</p></body>\n</html>`

function inlineMarkdown(value: string): ReactNode[] {
  const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    return part
  })
}

function Markdown({ source }: { source: string }) {
  const lines = source.split('\n')
  const nodes: ReactNode[] = []
  let code: string[] | null = null
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('```')) {
      if (code) { nodes.push(<pre key={`code-${index}`}><code>{code.join('\n')}</code></pre>); code = null } else code = []
      continue
    }
    if (code) { code.push(line); continue }
    if (line.startsWith('### ')) nodes.push(<h3 key={index}>{inlineMarkdown(line.slice(4))}</h3>)
    else if (line.startsWith('## ')) nodes.push(<h2 key={index}>{inlineMarkdown(line.slice(3))}</h2>)
    else if (line.startsWith('# ')) nodes.push(<h1 key={index}>{inlineMarkdown(line.slice(2))}</h1>)
    else if (/^[-*] /.test(line)) nodes.push(<div className={styles.bullet} key={index}>• <span>{inlineMarkdown(line.slice(2))}</span></div>)
    else if (line.trim()) nodes.push(<p key={index}>{inlineMarkdown(line)}</p>)
  }
  if (code) nodes.push(<pre key="code-last"><code>{code.join('\n')}</code></pre>)
  return <>{nodes}</>
}

export default function ArtifactPreview() {
  const [mode, setMode] = useState<PreviewMode>('markdown')
  const [source, setSource] = useState(START_MARKDOWN)
  const [imageUrl, setImageUrl] = useState('')
  const [fileName, setFileName] = useState('artifact.md')
  const [announcement, setAnnouncement] = useState('Markdown preview ready')

  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  const downloadType = mode === 'html' ? 'text/html' : 'text/markdown'
  const htmlPreview = useMemo(() => mode === 'html' ? source : '', [mode, source])

  function chooseMode(next: PreviewMode) {
    setMode(next)
    if (next === 'markdown') { setSource(START_MARKDOWN); setFileName('artifact.md') }
    if (next === 'html') { setSource(START_HTML); setFileName('preview.html') }
    setAnnouncement(`${next} preview ready`)
  }

  function loadFile(file?: File) {
    if (!file) return
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setFileName(file.name)
    if (file.type.startsWith('image/')) {
      setImageUrl(URL.createObjectURL(file)); setMode('image'); setAnnouncement(`Image preview loaded: ${file.name}`); return
    }
    const reader = new FileReader()
    reader.onload = () => { setSource(String(reader.result ?? '')); setMode(file.type === 'text/html' || file.name.endsWith('.html') ? 'html' : 'markdown'); setAnnouncement(`Text preview loaded: ${file.name}`) }
    reader.readAsText(file)
  }

  function download() {
    if (mode === 'image' && imageUrl) { const link = document.createElement('a'); link.href = imageUrl; link.download = fileName; link.click(); return }
    const url = URL.createObjectURL(new Blob([source], { type: downloadType }))
    const link = document.createElement('a'); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url)
  }

  return <div className={styles.page}>
    <Nav />
    <main className={styles.main}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>Local artifact studio</span>
        <h1>Edit it. Preview it.<br/><em>Keep it private.</em></h1>
        <p>Markdown, site, and image previews run entirely in your browser. Files are never uploaded.</p>
      </header>
      <div className={styles.toolbar}>
        <div role="group" aria-label="Preview type">
          {(['markdown','html','image'] as PreviewMode[]).map(item => <button type="button" key={item} aria-pressed={mode === item} onClick={() => chooseMode(item)}>{item === 'html' ? 'Site / HTML' : item[0].toUpperCase() + item.slice(1)}</button>)}
        </div>
        <label className={styles.fileButton}>Open a file<input type="file" accept="text/markdown,text/plain,text/html,image/*,.md" onChange={event => loadFile(event.target.files?.[0])} /></label>
        <button type="button" className={styles.download} onClick={download} disabled={mode === 'image' && !imageUrl}>Download artifact</button>
      </div>
      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
      <div className={styles.previewGrid}>
        <section className={styles.editorPanel} aria-label="Artifact source editor">
          <div className={styles.panelLabel}><span>Source</span><b>{fileName}</b></div>
          {mode === 'image' ? <div className={styles.imageDrop}><p>Open an image to preview it.</p></div> : <textarea aria-label={`${mode} source`} value={source} onChange={event => setSource(event.target.value)} spellCheck={false} />}
        </section>
        <section className={styles.renderPanel} aria-label="Rendered artifact preview">
          <div className={styles.panelLabel}><span>Preview</span><b>Sandboxed · local only</b></div>
          {mode === 'markdown' && <article className={styles.markdown}><Markdown source={source}/></article>}
          {mode === 'html' && <iframe title="Sandboxed site preview" sandbox="" srcDoc={htmlPreview} />}
          {mode === 'image' && (imageUrl ? <div className={styles.imagePreview}><img src={imageUrl} alt={`Preview of ${fileName}`}/></div> : <div className={styles.imageDrop}><p>No image selected.</p></div>)}
        </section>
      </div>
    </main>
    <Footer />
  </div>
}
