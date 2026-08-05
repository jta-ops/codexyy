import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import styles from './Pro.module.css'

type Account = {
  name?: string
  plan?: 'free' | 'pro' | 'pro_max'
  plan_amount?: number
  stripe_sub_id?: string
  monthly_spend?: number
  spend_month?: string
}

const models = [
  ['Claude 3.5 Sonnet', 'anthropic'],
  ['Claude 3.5 Haiku', 'anthropic'],
  ['Claude 3 Opus', 'anthropic'],
  ['GPT-4o', 'openai'],
  ['GPT-4o mini', 'openai'],
  ['Gemini Flash 1.5', 'google'],
  ['DeepSeek R1', 'deepseek'],
]

const proFeatures = [
  'Every codexyy Pro model',
  '$3.80 monthly hosted-model allowance',
  'No personal API key required',
  'Terminal and browser agent access',
  'Manage or cancel through Stripe',
]

const maxFeatures = [
  'Everything in Pro',
  'A larger hosted-model allowance',
  'Custom system instructions',
  'Choose the monthly level that fits',
  'Manage or cancel through Stripe',
]

const estimatorModels = [
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', input: 3, output: 15 },
  { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', input: .8, output: 4 },
  { id: 'openai/gpt-4o', name: 'GPT-4o', input: 5, output: 15 },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', input: .15, output: .6 },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5', input: .075, output: .3 },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', input: .55, output: 2.19 },
]

function CheckList({ items }: { items: string[] }) {
  return (
    <ul className={styles.featureList}>
      {items.map(item => (
        <li key={item}>
          <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
            <path d="M3 7.5 6 10.5 12 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export default function Pro() {
  const [account, setAccount] = useState<Account | null>(null)
  const [accountLoaded, setAccountLoaded] = useState(false)
  const [maxAmount, setMaxAmount] = useState(15)
  const [changingPlan, setChangingPlan] = useState(false)
  const [billingError, setBillingError] = useState('')
  const [estimateModel, setEstimateModel] = useState(estimatorModels[0].id)
  const [estimateMessages, setEstimateMessages] = useState(100)
  const [estimateInput, setEstimateInput] = useState(4000)
  const [estimateOutput, setEstimateOutput] = useState(1200)

  useEffect(() => {
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const oldDescription = description?.content
    const oldCanonical = canonical?.href
    document.title = 'Pro plans — codexyy.dev'
    if (description) description.content = 'Compare codexyy Free, Pro, and Pro Max plans for hosted coding models in the local codexyy agent.'
    if (canonical) canonical.href = 'https://codexyy.dev/pro'
    fetch('/auth/me', { credentials: 'include' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        setAccount(data)
        if (data?.plan === 'pro_max' && data.plan_amount) setMaxAmount(data.plan_amount)
      })
      .catch(() => setAccount(null))
      .finally(() => setAccountLoaded(true))
    return () => {
      document.title = 'codexyy.dev'
      if (description && oldDescription) description.content = oldDescription
      if (canonical && oldCanonical) canonical.href = oldCanonical
    }
  }, [])

  const subscribed = !!account?.stripe_sub_id
  const proHref = subscribed
    ? '/api/stripe/portal'
    : account
      ? '/api/stripe/checkout?plan=pro'
      : '/auth/login?plan=pro'
  const maxHref = subscribed
    ? '/api/stripe/portal'
    : account
      ? `/api/stripe/checkout?plan=pro_max&amount=${maxAmount}`
      : `/auth/login?plan=pro_max&amount=${maxAmount}`
  const allowance = (maxAmount * 0.47).toFixed(2)
  const selectedEstimateModel = estimatorModels.find(model => model.id === estimateModel) ?? estimatorModels[0]
  const estimatedCost = estimateMessages * ((estimateInput / 1_000_000) * selectedEstimateModel.input + (estimateOutput / 1_000_000) * selectedEstimateModel.output)
  const estimatedPlan = estimatedCost <= 3.8 ? 'Pro' : estimatedCost <= 7.05 ? 'Pro Max $15' : estimatedCost <= 9.4 ? 'Pro Max $20' : estimatedCost <= 11.75 ? 'Pro Max $25' : 'Pro Max $30 or usage add-on'
  const liveLimit = account?.plan === 'pro' ? 3.8 : account?.plan === 'pro_max' ? (account.plan_amount || 15) * .47 : 0
  const liveSpend = account?.spend_month === new Date().toISOString().slice(0,7) ? account.monthly_spend || 0 : 0

  async function changePlan(plan: 'pro' | 'pro_max') {
    if (changingPlan) return
    setChangingPlan(true); setBillingError('')
    try {
      const response = await fetch('/api/stripe/change-plan', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, amount: maxAmount }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.detail || 'Plan change failed')
      setAccount(current => current ? { ...current, plan, plan_amount: result.amount } : current)
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'Plan change failed')
    } finally { setChangingPlan(false) }
  }

  return (
    <>
      <Nav />
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.glow} aria-hidden="true" />
          <span className={styles.eyebrow}>codexyy hosted models</span>
          <h1>More model power.<br /><em>Zero key setup.</em></h1>
          <p>
            Pro gives your local codexyy agent a managed catalog of premium coding models.
            Sign in, choose a model, and build—billing and model access stay connected to one account.
          </p>
          <div className={styles.heroActions}>
            <a href="#plans" className={styles.primary}>Compare plans</a>
            <a href="/download" className={styles.secondary}>Install the agent</a>
          </div>
          {accountLoaded && account && (
            <div className={styles.accountState} role="status">
              Signed in as <strong>{account.name || 'your account'}</strong>
              <span />
              Current plan: <b>{account.plan === 'pro_max' ? 'Pro Max' : account.plan === 'pro' ? 'Pro' : 'Free'}</b>
              {subscribed && <a href="/api/stripe/portal">Manage billing</a>}
            </div>
          )}
          {liveLimit > 0 && <div className={styles.usage} aria-label="Monthly hosted model usage"><div><span>Monthly usage</span><strong>${liveSpend.toFixed(2)} used · ${Math.max(0,liveLimit-liveSpend).toFixed(2)} remaining</strong></div><progress max={liveLimit} value={Math.min(liveLimit,liveSpend)} /></div>}
        </section>

        <section className={styles.modelSection} aria-labelledby="models-title">
          <div className={styles.sectionHead}>
            <span>Included catalog</span>
            <h2 id="models-title">Use the right model for each job.</h2>
            <p>These models appear automatically under codexyy Pro in the agent model picker.</p>
          </div>
          <div className={styles.models}>
            {models.map(([name, provider], index) => (
              <article className={styles.model} key={name}>
                <i>{String(index + 1).padStart(2, '0')}</i>
                <div><strong>{name}</strong><span>{provider}</span></div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.plansSection} id="plans" aria-labelledby="plans-title">
          <div className={styles.sectionHead}>
            <span>Simple monthly plans</span>
            <h2 id="plans-title">Start free. Upgrade when you need more.</h2>
            <p>Prices are in USD. Stripe handles payment details; codexyy never stores your card.</p>
            {subscribed && <p>Plan changes use Stripe prorations automatically. Stripe shows the resulting credit or charge on your invoice.</p>}
            {billingError && <p role="alert" style={{ color: '#ff6b35' }}>{billingError}</p>}
          </div>

          <div className={styles.planGrid}>
            <article className={styles.planCard}>
              <div className={styles.planTop}>
                <div><span className={styles.planName}>Free</span><p>Hosted basics</p></div>
                <div className={styles.price}><strong>$0</strong><span>forever</span></div>
              </div>
              <p className={styles.planIntro}>A full local agent plus 30 hosted messages each week on the free catalog.</p>
              <CheckList items={['Full local coding agent', '30 hosted messages each week', 'Nine free hosted models', 'cxy repository workflow', 'No card required']} />
              <a className={styles.planSecondary} href="/download">Install free</a>
            </article>

            <article className={`${styles.planCard} ${styles.featured}`}>
              <span className={styles.popular}>Most popular</span>
              <div className={styles.planTop}>
                <div><span className={styles.planName}>Pro</span><p>Premium catalog</p></div>
                <div className={styles.price}><strong>$5</strong><span>/ month</span></div>
              </div>
              <p className={styles.planIntro}>Premium hosted models with enough monthly allowance for focused coding sessions.</p>
              <CheckList items={proFeatures} />
              {subscribed && account?.plan !== 'pro'
                ? <button type="button" className={styles.planPrimary} disabled={changingPlan} onClick={() => void changePlan('pro')}>{changingPlan ? 'Changing…' : 'Switch to Pro'}</button>
                : <a className={styles.planPrimary} href={proHref}>{subscribed ? 'Manage billing' : account?.plan === 'pro' ? 'Current plan' : account ? 'Continue to checkout' : 'Sign in and continue'}</a>}
            </article>

            <article className={styles.planCard}>
              <div className={styles.planTop}>
                <div><span className={styles.planName}>Pro Max</span><p>Pick your level</p></div>
                <div className={styles.price}><strong>${maxAmount}</strong><span>/ month</span></div>
              </div>
              <p className={styles.planIntro}>The Pro catalog with more monthly model usage and custom system instructions.</p>
              <div className={styles.amountPicker} aria-label="Choose a Pro Max monthly price">
                {[15, 20, 25, 30].map(amount => (
                  <button
                    type="button"
                    key={amount}
                    aria-pressed={maxAmount === amount}
                    className={maxAmount === amount ? styles.amountActive : ''}
                    onClick={() => setMaxAmount(amount)}
                  >
                    ${amount}
                  </button>
                ))}
              </div>
              <div className={styles.allowance}>About <strong>${allowance}</strong> in hosted-model usage each month</div>
              <CheckList items={maxFeatures} />
              {subscribed && (account?.plan !== 'pro_max' || account.plan_amount !== maxAmount)
                ? <button type="button" className={styles.planSecondary} disabled={changingPlan} onClick={() => void changePlan('pro_max')}>{changingPlan ? 'Changing…' : `Change to $${maxAmount} Pro Max`}</button>
                : <a className={styles.planSecondary} href={maxHref}>{subscribed ? 'Manage billing' : account?.plan === 'pro_max' ? 'Current plan' : account ? 'Continue to checkout' : 'Sign in and continue'}</a>}
            </article>
          </div>
        </section>

        <section className={styles.howSection} aria-labelledby="estimator-title">
          <div className={styles.sectionHead}><span>Usage estimator</span><h2 id="estimator-title">Match a plan to your workload.</h2><p>This estimate uses the displayed per-token model rates. Provider caching and actual response length can change the final amount.</p></div>
          <div className={styles.estimator}>
            <label>Model<select value={estimateModel} onChange={event=>setEstimateModel(event.target.value)}>{estimatorModels.map(model=><option value={model.id} key={model.id}>{model.name}</option>)}</select></label>
            <label>Messages / month<input type="number" min="1" max="100000" value={estimateMessages} onChange={event=>setEstimateMessages(Math.max(1,Number(event.target.value)||1))}/></label>
            <label>Input tokens / message<input type="number" min="1" max="1000000" value={estimateInput} onChange={event=>setEstimateInput(Math.max(1,Number(event.target.value)||1))}/></label>
            <label>Output tokens / message<input type="number" min="1" max="1000000" value={estimateOutput} onChange={event=>setEstimateOutput(Math.max(1,Number(event.target.value)||1))}/></label>
            <div className={styles.estimateResult}><span>Estimated model usage</span><strong>${estimatedCost.toFixed(2)} / month</strong><b>Suggested: {estimatedPlan}</b></div>
          </div>
        </section>

        <section className={styles.howSection} aria-labelledby="how-pro-works">
          <div className={styles.sectionHead}>
            <span>How access works</span>
            <h2 id="how-pro-works">No keys to copy. No provider setup.</h2>
          </div>
          <ol className={styles.steps}>
            <li><i>01</i><div><strong>Choose a plan</strong><p>Sign in and complete the secure Stripe checkout.</p></div></li>
            <li><i>02</i><div><strong>Open codexyy</strong><p>Your saved cxy login is synced into the local agent automatically.</p></div></li>
            <li><i>03</i><div><strong>Pick a Pro model</strong><p>The full Pro catalog appears in the model picker under your account.</p></div></li>
          </ol>
        </section>

        <section className={styles.faq} aria-labelledby="faq-title">
          <div className={styles.sectionHead}>
            <span>Questions</span>
            <h2 id="faq-title">The useful details.</h2>
          </div>
          <div className={styles.faqList}>
            <details><summary>Does Pro install a different agent?</summary><p>No. The same local agent is used on every plan. Pro adds premium hosted-model access to its model picker.</p></details>
            <details><summary>What happens when I reach the monthly allowance?</summary><p>Premium requests pause until the next month. Your local agent, repositories, and free catalog remain available.</p></details>
            <details><summary>Can I cancel?</summary><p>Yes. Use Manage billing on this page or your dashboard to cancel through Stripe. Your plan remains active through the paid period.</p></details>
            <details><summary>Do you store card details?</summary><p>No. Checkout and payment management are hosted by Stripe. codexyy stores only your Stripe customer and subscription references.</p></details>
            <details><summary>How does Pro Max usage work?</summary><p>About 47% of the selected monthly level is available for hosted-model usage. The page updates the exact allowance before checkout.</p></details>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
