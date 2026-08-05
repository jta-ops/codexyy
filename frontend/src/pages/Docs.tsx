import { useMemo, useState } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './InfoPage.module.css'

const docs = [
  {title:'Install CLI + AI',body:'Install the cxy CLI and local Codexyy agent together. Downloads are SHA-256 verified before anything is installed.',command:'curl -fsSL https://codexyy.dev/cli/ai | sh'},
  {title:'Check your setup',body:'Diagnose API health, authentication, releases, PATH, and the optional local agent.',command:'cxy doctor'},
  {title:'Sign in',body:'Open the provider chooser and connect the CLI with a short-lived device code.',command:'cxy login'},
  {title:'List repositories',body:'See every repository available to the current Codexyy account.',command:'cxy repos ls -o json'},
  {title:'Pull a repository',body:'Download a repository into a local working directory.',command:'cxy pull <repo> ./project'},
  {title:'Start an isolated task',body:'Create a dedicated remote branch and local workspace for one agent task.',command:'cxy task start <repo> "fix checkout" -o json'},
  {title:'Checkpoint a working tree',body:'Save every non-secret source file before a larger edit.',command:'cxy checkpoint create ./project --name before-edit'},
  {title:'Restore a checkpoint',body:'Preview an exact repository-wide restore, then repeat with --yes after reviewing the plan.',command:'cxy checkpoint restore <id> ./project'},
  {title:'Preview a push',body:'Show additions, edits, and deletions without uploading anything.',command:'cxy push <repo> ./project --dry-run'},
  {title:'Approve a push',body:'After reviewing the visible plan, explicitly approve the real commit.',command:'cxy push <repo> ./project --yes -m "describe the change"'},
  {title:'Run the agent',body:'Open the Codexyy agent in the terminal with hosted models and cxy configured.',command:'codexyy'},
  {title:'Run the browser UI',body:'Open the local agent in your browser. Network exposure automatically requires a generated password.',command:'codexyy web --port 4610'},
  {title:'Update cxy',body:'Download the current platform binary and verify its checksum before replacement.',command:'cxy update'},
  {title:'Agent dry run',body:'Preview the engine URL, checksum, directories, launcher, and login flow without changing files.',command:'cxy install ai --dry-run'},
  {title:'Get help',body:'Browse every command and option provided by the installed version.',command:'cxy --help'},
]

export default function Docs(){
  const [query,setQuery]=useState(''); const [copied,setCopied]=useState('')
  const shown=useMemo(()=>docs.filter(item=>(item.title+' '+item.body+' '+item.command).toLowerCase().includes(query.toLowerCase())),[query])
  const copy=(value:string)=>navigator.clipboard.writeText(value).then(()=>{setCopied(value);window.setTimeout(()=>setCopied(''),1200)})
  return <div className={styles.page}><a className={styles.skip} href="#main">Skip to docs</a><Nav/><main id="main" className={styles.main}><section className={styles.hero}><span className={styles.eyebrow}>Codexyy documentation</span><h1>Find the command.<br/><em>Keep building.</em></h1><p>Searchable setup and workflow documentation for the CLI, local agent, repositories, releases, and safety controls.</p></section><div className={styles.toolbar}><label style={{width:'100%'}}><span className={styles.eyebrow}>Search documentation</span><input className={styles.search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try push, update, browser, models…"/></label></div>{shown.length===0?<div className={styles.empty}>No documentation matched “{query}”.</div>:<section className={styles.grid}>{shown.map(item=><article className={styles.card} key={item.title}><span className={styles.eyebrow}>CLI guide</span><h2>{item.title}</h2><p>{item.body}</p><div className={styles.code}><code>{item.command}</code><button onClick={()=>copy(item.command)}>{copied===item.command?'Copied':'Copy'}</button></div></article>)}</section>}</main><Footer/></div>
}
