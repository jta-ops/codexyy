import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './InfoPage.module.css'

const releases=[
  {version:'CLI v1.1.0',date:'August 5, 2026',items:['Added isolated per-task branches and workspaces with cxy task start.','Added checksummed repository-wide checkpoints with previewable, approval-gated restore.','Published a Minisign-authenticated release manifest and pinned public verification key.','Added a visual agent launcher and local-only Markdown, site, and image artifact studio.']},
  {version:'CLI v1.0.1',date:'August 5, 2026',items:['Added doctor and verified self-update checks.','Added safe complete uninstall previews and offline installation bundles.','Added model recommendations, engine compatibility checks, automatic completions, and persisted PATH setup.']},
  {version:'Auth & mail v3.0.0',date:'August 5, 2026',items:['Microsoft Graph-only email delivery with branded multipart templates.','Passwordless account and support access with single-use links.','Thirty-one account/marketing templates and ten editable support presets.']},
  {version:'CLI & Agent v1.0.0',date:'August 5, 2026',items:['One-command CLI plus AI installation for Linux and macOS.','Automatic Codexyy model catalogs and managed cxy instructions.','SHA-256 release verification, doctor, update, dry-run, and shell completions.','Password protection is automatic whenever browser mode is exposed to a network.']},
  {version:'Product family preview',date:'August 5, 2026',items:['Deploy, Teams, Review, Automate, Workspaces, Memory, Guard, Marketplace, Pulse, and One pages.','Authenticated, idempotent early-access registration.','Accessible product navigation, pricing disclosure, status, documentation, and live service health.']},
]
export default function Changelog(){return <div className={styles.page}><Nav/><main className={styles.main}><section className={styles.hero}><span className={styles.eyebrow}>Release history</span><h1>What shipped.<br/><em>What changed.</em></h1><p>A readable record of production releases across the website, CLI, local agent, authentication, and email platform.</p></section><section className={styles.timeline}>{releases.map(r=><article className={styles.release} key={r.version}><time>{r.date}</time><h2>{r.version}</h2><ul>{r.items.map(item=><li key={item}>{item}</li>)}</ul></article>)}</section></main><Footer/></div>}
