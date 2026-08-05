import { useState, useEffect, useRef } from 'react'
import { Link } from '../router'
import { PRODUCTS } from '../data/products'
import styles from './Nav.module.css'

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const moreRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/auth/me', { credentials: 'include', signal: controller.signal })
      .then(response => setSignedIn(response.ok))
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (moreRef.current?.open && !moreRef.current.contains(event.target as Node)) {
        moreRef.current.open = false
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && moreRef.current?.open) {
        moreRef.current.open = false
        moreRef.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const scrollTo = (id: string) => {
    if (window.location.pathname !== '/') {
      window.location.href = `/#${id}`
      return
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}>
      <div className={styles.inner}>
        <a href="/" className={styles.logo}>
          <span className={styles.logoText}>codexyy</span>
          <span className={styles.logoDot}>.dev</span>
        </a>
        <div className={styles.links}>
          <button onClick={() => scrollTo('features')}>Features</button>
          <button onClick={() => scrollTo('languages')}>Languages</button>
          <button onClick={() => scrollTo('how')}>How it works</button>
          <Link to="/explore">Explore</Link>
          <Link to="/pro">Pro</Link>
          <details className={styles.more} ref={moreRef}>
            <summary>More <span aria-hidden="true">⌄</span></summary>
            <div className={styles.moreMenu} aria-label="More Codexyy products">
              <div className={styles.moreTop}>
                <span>More from Codexyy</span>
                <a href="/one">Get everything with One →</a>
              </div>
              <div className={styles.moreUtility}>
                <a href="/agent/start">Start agent</a><a href="/preview">Artifact studio</a><a href="/docs">Docs</a><a href="/demo">Demo</a><a href="/changelog">Changelog</a><a href="/status">Status</a>
              </div>
              <div className={styles.productLinks}>
                {PRODUCTS.map(product => (
                  <a href={`/${product.slug}`} key={product.slug} onClick={() => { if (moreRef.current) moreRef.current.open = false }}>
                    <i style={{ background: product.color, boxShadow: `0 0 12px ${product.color}66` }} />
                    <span><strong>{product.shortName}</strong><small>{product.summary}</small></span>
                    <b>{product.price}</b>
                  </a>
                ))}
              </div>
            </div>
          </details>
        </div>
        <div className={styles.navActions}>
          <Link to="/download" className={styles.playBtn}>Install</Link>
          <a
            href={signedIn ? '/dashboard' : '/auth/login?next=/dashboard'}
            className={styles.cta}
          >
            {signedIn ? 'Dashboard' : 'Sign in'}
          </a>
        </div>
      </div>
    </nav>
  )
}
