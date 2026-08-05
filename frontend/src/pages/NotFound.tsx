import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './InfoPage.module.css'
export default function NotFound() { return <div className={styles.page}><Nav /><main className={styles.main}><header className={styles.hero}><span className={styles.eyebrow}>404 · Not found</span><h1>This route<br /><em>isn’t here.</em></h1><p>The page may have moved, or the address may be incomplete.</p><div className={styles.toolbar}><a className={styles.button} href="/">Home</a><a className={styles.button} href="/docs">Documentation</a><a className={styles.button} href="/status">System status</a></div></header></main><Footer /></div> }
