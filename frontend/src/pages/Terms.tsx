import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './InfoPage.module.css'

export default function Terms() {
  return <div className={styles.page}><Nav /><main className={styles.main}><header className={styles.hero}><span className={styles.eyebrow}>Effective August 5, 2026</span><h1>Terms of <em>service.</em></h1><p>Plain-language rules for using Codexyy while the platform is in preview.</p></header><section className={styles.grid}>
    <article className={styles.card}><h2>Accounts and access</h2><p>Keep access links and local tokens private. You are responsible for activity performed through your account. Tell us promptly if you believe access has been compromised.</p></article>
    <article className={styles.card}><h2>Your code and content</h2><p>You retain ownership of code and content you provide. You give Codexyy only the limited permission needed to store, process, execute, and return it as part of the service you requested.</p></article>
    <article className={styles.card}><h2>Acceptable use</h2><p>Do not use Codexyy to compromise systems, distribute malware, evade access controls, abuse providers, infringe rights, or run workloads you are not authorized to run.</p></article>
    <article className={styles.card}><h2>Subscriptions</h2><p>Paid plans renew at the displayed interval until cancelled. Taxes and currency conversion may be added by Stripe or your payment provider. You can cancel through Manage billing; access continues according to the billing terms shown at checkout.</p></article>
    <article className={styles.card}><h2>Preview services</h2><p>Preview products may change, pause, or be withdrawn before general availability. A preview price is not charged unless a checkout page clearly presents the final amount and you confirm payment.</p></article>
    <article className={styles.card}><h2>Availability and liability</h2><p>We work to keep Codexyy reliable, but software and model providers can fail. Keep independent copies of important work. To the extent permitted by law, Codexyy is provided without guarantees beyond non-excludable consumer rights.</p></article>
    <article className={styles.card}><h2>Contact</h2><p>Questions, billing requests, and security reports can be sent to platform@codexyy.dev.</p></article>
  </section></main><Footer /></div>
}
