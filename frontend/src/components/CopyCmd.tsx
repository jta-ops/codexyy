import { useState } from 'react'
import styles from './CopyCmd.module.css'

const CMD = 'curl -fsSL https://codexyy.dev/cli/ai | sh'

export function CopyCmdButton({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = (e: React.MouseEvent) => {
    e.preventDefault()
    navigator.clipboard.writeText(CMD).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button onClick={copy} className={`${styles.btn} ${className ?? ''} ${copied ? styles.copied : ''}`}>
      <span className={styles.code}>{copied ? '✓ copied!' : CMD}</span>
      <span className={styles.icon}>
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 6.5l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M2 9V2h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
    </button>
  )
}

export function CopyCmdInline() {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(CMD).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button onClick={copy} className={`${styles.inline} ${copied ? styles.inlineCopied : ''}`} title="Click to copy">
      <code>{copied ? '✓ copied!' : CMD}</code>
      <span className={styles.inlineIcon}>
        {copied ? (
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
            <path d="M2 6.5l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
            <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M2 9V2h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
    </button>
  )
}
