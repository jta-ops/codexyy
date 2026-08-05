import styles from './Footer.module.css'

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <div className={styles.logo}>
            <span>codexyy</span><span className={styles.dot}>.dev</span>
          </div>
          <p className={styles.tagline}>Write code. Run it instantly. Share anywhere.</p>
        </div>
        <div className={styles.links}>
          <div className={styles.col}>
            <div className={styles.colTitle}>Product</div>
            <a href="/download">Install</a>
            <a href="/pro">Pro</a>
            <a href="/deploy">Deploy</a>
            <a href="/teams">Teams</a>
            <a href="/one">Codexyy One</a>
          </div>
          <div className={styles.col}>
            <div className={styles.colTitle}>More</div>
            <a href="/review">Review</a>
            <a href="/automate">Automate</a>
            <a href="/workspaces">Workspaces</a>
            <a href="/memory">Memory</a>
            <a href="/guard">Guard</a>
            <a href="/marketplace">Marketplace</a>
            <a href="/pulse">Pulse</a>
          </div>
          <div className={styles.col}>
            <div className={styles.colTitle}>Learn</div>
            <a href="/docs">Documentation</a>
            <a href="/demo">Agent demo</a>
            <a href="/changelog">Changelog</a>
            <a href="/status">System status</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="mailto:platform@codexyy.dev">Support</a>
          </div>
        </div>
      </div>
      <div className={styles.bottom}>
        <div className={styles.bottomInner}>
          <span className={styles.copy}>© 2026 codexyy.dev</span>
          <span className={styles.ver}>cli · agent · playground</span>
        </div>
      </div>
    </footer>
  )
}
