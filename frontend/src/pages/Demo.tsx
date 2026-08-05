import { FormEvent, useState } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './InfoPage.module.css'

type Message={role:'you'|'agent';text:string}
export default function Demo(){
  const [prompt,setPrompt]=useState('Review my current change and tell me what could break')
  const [messages,setMessages]=useState<Message[]>([{role:'agent',text:'This is an interactive preview. Try a task and I’ll show the safe Codexyy workflow—no repository or account is touched.'}])
  const submit=(event:FormEvent)=>{event.preventDefault();if(!prompt.trim())return;const value=prompt.trim();setMessages(items=>[...items,{role:'you',text:value},{role:'agent',text:'I would identify the repository, create an isolated task branch, inspect the relevant diff, run focused checks, and show you the result. Any cxy push stays blocked until you approve the visible push plan.'}]);setPrompt('')}
  return <div className={styles.page}><Nav/><main className={styles.main}><section className={styles.hero}><span className={styles.eyebrow}>Interactive agent preview</span><h1>See the workflow.<br/><em>Install when ready.</em></h1><p>Explore how Codexyy approaches repository work, verification, and publishing without connecting an account or changing a file.</p></section><section className={styles.demo} aria-label="Agent demo"><div className={styles.demoTop}>CODEXYY DEMO · NO TOOLS OR EXTERNAL ACTIONS</div><div className={styles.messages} aria-live="polite">{messages.map((message,index)=><div key={index} className={`${styles.message} ${message.role==='agent'?styles.agentMessage:''}`}><strong>{message.role==='agent'?'Codexyy':'You'}</strong><br/>{message.text}</div>)}</div><form className={styles.demoForm} onSubmit={submit}><label style={{flex:1}}><span className={styles.eyebrow}>Try a task</span><input className={styles.prompt} value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={300}/></label><button className={styles.button}>Run preview</button></form></section></main><Footer/></div>
}
