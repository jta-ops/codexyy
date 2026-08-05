import { useState } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './Setup.module.css'

const INSTALL = 'curl -fsSL https://codexyy.dev/cli/ai | sh'

const hostedModels = [
  'Llama 3.3 70B',
  'Qwen 2.5 Coder 32B',
  'DeepSeek R1 32B',
  'Llama 3.1 8B',
  'Mistral 7B',
  'GPT-4o mini',
  'GPT-4.1 nano',
  'Claude 3.5 Haiku',
  'Claude Haiku 4.5',
]

const proModels = [
  'Claude 3.5 Sonnet',
  'Claude 3.5 Haiku',
  'Claude 3 Opus',
  'GPT-4o',
  'GPT-4o mini',
  'Gemini Flash 1.5',
  'DeepSeek R1',
]

function Command({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className={styles.command}>
      {label && <span className={styles.commandLabel}>{label}</span>}
      <code>{value}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${value}`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function Setup() {
  return (
    <>
      <Nav />
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}><span /> CLI + local AI agent</div>
          <h1>Everything you need.<br /><em>One command.</em></h1>
          <p className={styles.lead}>
            Install the cxy command line and the complete codexyy coding agent,
            already connected to your account, repositories, and hosted models.
          </p>
          <Command value={INSTALL} />
          <div className={styles.support}>
            <span>Linux</span><i />
            <span>macOS</span><i />
            <span>Intel / AMD64</span><i />
            <span>Apple Silicon / ARM64</span>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className={styles.kicker}>01 / What gets installed</span>
            <h2>A complete local workspace.</h2>
          </div>
          <div className={styles.cards}>
            <article className={styles.card}>
              <span className={styles.cardIndex}>CLI</span>
              <h3>cxy command line</h3>
              <p>Pull, edit, inspect, and publish codexyy repositories without leaving your terminal.</p>
            </article>
            <article className={styles.card}>
              <span className={styles.cardIndex}>AI</span>
              <h3>codexyy agent</h3>
              <p>A branded terminal and browser coding agent with its engine and interface installed locally.</p>
            </article>
            <article className={styles.card}>
              <span className={styles.cardIndex}>AUTO</span>
              <h3>Ready on first launch</h3>
              <p>Your login, model catalogs, cxy access, theme, and repository workflow are configured automatically.</p>
            </article>
          </div>
        </section>

        <section className={`${styles.section} ${styles.splitSection}`}>
          <div className={styles.sectionHeading}>
            <span className={styles.kicker}>02 / Run it</span>
            <h2>Terminal or browser.<br />Your choice.</h2>
            <p>The agent stays on localhost unless you deliberately expose it to your network.</p>
          </div>
          <div className={styles.commands}>
            <Command label="Terminal interface" value="codexyy" />
            <Command label="Browser interface" value="codexyy web" />
            <Command label="Choose a port" value="codexyy web --port 4610" />
            <Command label="Allow network access" value="codexyy web --expose all" />
            <div className={styles.warning}>
              Network exposure currently has no built-in password. Only use it on a network you trust.
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className={styles.kicker}>03 / Models</span>
            <h2>Our models appear automatically.</h2>
            <p>Sign in once and both catalogs are added to the agent's model picker. Pro models follow your account plan.</p>
          </div>
          <div className={styles.modelGrid}>
            <div className={styles.modelGroup}>
              <div className={styles.modelTitle}><span>codexyy Hosted</span><b>{hostedModels.length}</b></div>
              <div className={styles.modelList}>
                {hostedModels.map(model => <span key={model}>{model}</span>)}
              </div>
            </div>
            <div className={styles.modelGroup}>
              <div className={styles.modelTitle}><span>codexyy Pro</span><b>{proModels.length}</b></div>
              <div className={styles.modelList}>
                {proModels.map(model => <span key={model}>{model}</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.splitSection}`}>
          <div className={styles.sectionHeading}>
            <span className={styles.kicker}>04 / cxy inside the agent</span>
            <h2>The AI knows your workflow.</h2>
            <p>
              The installed agent can use cxy immediately. It knows how to find your repositories,
              pull one into its workspace, check its changes, and publish only when you ask.
            </p>
          </div>
          <div className={styles.commands}>
            <Command label="Sign in" value="cxy login" />
            <Command label="List repositories" value="cxy repos ls" />
            <Command label="Pull a repository" value="cxy pull <repo> ./project" />
            <Command label="Publish requested changes" value={'cxy push <repo> ./project -m "your message"'} />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className={styles.kicker}>05 / Manage the install</span>
            <h2>Separate, repair, or remove.</h2>
          </div>
          <div className={styles.manageGrid}>
            <Command label="CLI only" value="curl -fsSL https://codexyy.dev/cli | sh" />
            <Command label="AI after installing cxy" value="cxy install ai" />
            <Command label="Refresh or repair the AI" value="cxy install ai --force" />
            <Command label="Remove the local AI" value="cxy uninstall ai" />
          </div>
          <p className={styles.footnote}>
            Supported on Linux and macOS. The installer is a static native binary—no Node.js,
            npm, Docker, or separate runtime is required.
          </p>
        </section>

        <section className={styles.finalCta}>
          <span className={styles.kicker}>Ready when you are</span>
          <h2>Bring codexyy to your machine.</h2>
          <Command value={INSTALL} />
        </section>
      </main>
      <Footer />
    </>
  )
}
