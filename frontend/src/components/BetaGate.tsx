import { useState } from 'react'
import styles from './BetaGate.module.css'

type Props = { onVerified: () => void }

type Step = 'start' | 'code'

const BETA_TOKEN_KEY = 'cxy_beta'

export function hasBetaAccess(): boolean {
  return !!localStorage.getItem(BETA_TOKEN_KEY)
}

export function clearBetaAccess() {
  localStorage.removeItem(BETA_TOKEN_KEY)
}

export default function BetaGate({ onVerified }: Props) {
  const [step, setStep] = useState<Step>('start')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function requestCode() {
    const e = email.trim().toLowerCase()
    if (!e.includes('@') || !e.includes('.')) { setError('Enter a valid email'); return }
    setError('')
    setLoading(true)
    try {
      const r = await fetch('/api/beta/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e }),
      })
      if (!r.ok) { const d = await r.json(); setError(d.detail || 'Failed to send code'); return }
      setStep('code')
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  async function verifyCode() {
    const c = code.trim()
    if (c.length !== 6) { setError('Enter the 6-digit code'); return }
    setError('')
    setLoading(true)
    try {
      const r = await fetch('/api/beta/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: c }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.detail || 'Wrong code'); return }
      localStorage.setItem(BETA_TOKEN_KEY, d.token)
      onVerified()
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  function openAccountSignIn() {
    const next = window.location.pathname
    window.location.href = `/auth/login?next=${encodeURIComponent(next)}`
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <span className={styles.logo}>
          codexyy<span className={styles.logoDot}>.dev</span>
        </span>

        {step === 'start' && (
          <>
            <h2 className={styles.title}>Beta access required</h2>
            <p className={styles.sub}>
              codexyy is currently in private beta. Sign in to your account or use a beta access code to run code.
            </p>

            <button className={styles.googleBtn} onClick={openAccountSignIn}>
              <span aria-hidden="true">@</span>
              Sign in or create account
            </button>

            <div className={styles.divider}>
              <div className={styles.dividerLine} />
              <span className={styles.dividerText}>or use a beta code</span>
              <div className={styles.dividerLine} />
            </div>

            <label className={styles.label} htmlFor="beta-email">Email address</label>
            <input
              id="beta-email"
              className={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && requestCode()}
              autoComplete="email"
              autoFocus
            />
            {error && <div className={styles.error}>{error}</div>}

            <button className={styles.btn} onClick={requestCode} disabled={loading}>
              {loading ? '...' : 'Send verification code'}
            </button>

            <p className={styles.note}>
              No sign-up required. Just verify you're human.<br />
              Code expires in 15 minutes.
            </p>
          </>
        )}

        {step === 'code' && (
          <>
            <h2 className={styles.title}>Check your email</h2>
            <p className={styles.sub}>
              Sent a 6-digit code to <strong style={{ color: '#e2e2ec' }}>{email}</strong>.
            </p>

            <label className={styles.label} htmlFor="beta-code">Verification code</label>
            <input
              id="beta-code"
              className={`${styles.input} ${styles.codeInput}`}
              type="text"
              inputMode="numeric"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError('') }}
              onKeyDown={e => e.key === 'Enter' && verifyCode()}
              autoFocus
            />
            {error && <div className={styles.error}>{error}</div>}

            <button className={styles.btn} onClick={verifyCode} disabled={loading || code.length !== 6}>
              {loading ? '...' : 'Verify & enter playground'}
            </button>

            <button className={`${styles.btn} ${styles.backBtn}`} onClick={() => { setStep('start'); setCode(''); setError('') }}>
              ← Back
            </button>

            <button
              className={styles.resend}
              onClick={() => { setCode(''); setError(''); requestCode() }}
              disabled={loading}
            >
              Resend code
            </button>
          </>
        )}
      </div>
    </div>
  )
}
