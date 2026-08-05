import { useEffect, useState, type CSSProperties } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import { PRODUCTS, type Product } from '../data/products'
import styles from './ProductPage.module.css'

type Props = { product: Product }

export default function ProductPage({ product }: Props) {
  const [joined, setJoined] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const oldTitle = document.title
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const oldDescription = description?.content
    const oldCanonical = canonical?.href
    const structuredData = document.createElement('script')
    structuredData.type = 'application/ld+json'
    structuredData.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: product.name,
      applicationCategory: 'DeveloperApplication',
      description: product.description,
      url: `https://codexyy.dev/${product.slug}`,
      offers: { '@type': 'Offer', price: product.price.replace(/[^0-9.]/g, '') || '0', priceCurrency: 'AUD', availability: 'https://schema.org/PreOrder' },
    })
    document.head.appendChild(structuredData)
    document.title = `${product.name} — codexyy.dev`
    if (description) description.content = product.description
    if (canonical) canonical.href = `https://codexyy.dev/${product.slug}`
    if (new URLSearchParams(window.location.search).get('interest') === 'joined') setJoined(true)
    const controller = new AbortController()
    fetch('/api/product-interest', { credentials: 'include', signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        const entry = data?.products?.find((item: { slug: string; joined: boolean }) => item.slug === product.slug)
        if (entry?.joined) setJoined(true)
      })
      .catch(() => {})
    return () => {
      controller.abort()
      structuredData.remove()
      document.title = oldTitle
      if (description && oldDescription) description.content = oldDescription
      if (canonical && oldCanonical) canonical.href = oldCanonical
    }
  }, [product])

  async function joinEarlyAccess() {
    if (joining || joined) return
    setJoining(true)
    setError('')
    try {
      const response = await fetch('/api/product-interest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: product.slug }),
      })
      if (response.status === 401) {
        const next = `/${product.slug}?interest=1`
        window.location.href = `/auth/login?next=${encodeURIComponent(next)}`
        return
      }
      if (!response.ok) throw new Error('Unable to join')
      setJoined(true)
      window.history.replaceState({}, '', `/${product.slug}?interest=joined`)
    } catch {
      setError('We could not save your early-access request. Please try again.')
    } finally {
      setJoining(false)
    }
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('interest') === '1') {
      void joinEarlyAccess()
    }
    // The product slug intentionally controls this one-time post-login action.
  }, [product.slug])

  const style = {
    '--product': product.color,
    '--product-rgb': product.rgb,
  } as CSSProperties

  return (
    <div className={`${styles.site} ${product.slug === 'one' ? styles.one : ''}`} style={style}>
      <Nav />
      <main>
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>{product.eyebrow}</span>
            <h1>{product.headline}<br /><em>{product.accentLine}</em></h1>
            <p>{product.description}</p>
            <div className={styles.actions}>
              <button type="button" onClick={joinEarlyAccess} disabled={joining || joined} className={styles.primary}>
                {joined ? 'Early access joined ✓' : joining ? 'Joining…' : 'Join early access'}
              </button>
              <a className={styles.secondary} href="#features">Explore features</a>
            </div>
            <div className={error ? styles.actionError : styles.actionStatus} role={error ? 'alert' : 'status'} aria-live="polite">
              {error || (joined ? `You joined the ${product.shortName} preview. We’ll use your account email for release updates.` : '')}
            </div>
            <div className={styles.availability}><span /> Product preview · no charge today</div>
          </div>
          <div className={styles.productPreview} aria-label={`${product.name} interface preview`}>
            <div className={styles.previewTop}><span /><span /><span /><b>{product.shortName.toLowerCase()}</b></div>
            <div className={styles.previewBody}>
              <div className={styles.previewMark}>{product.shortName.slice(0, 2).toUpperCase()}</div>
              {product.preview.map((item, index) => (
                <div className={styles.previewRow} key={item}>
                  <i>{String(index + 1).padStart(2, '0')}</i><span>{item}</span><b>{index === product.preview.length - 1 ? 'ready' : 'done'}</b>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.features} id="features" aria-labelledby={`${product.slug}-features`}>
          <div className={styles.sectionHead}>
            <span>Included capabilities</span>
            <h2 id={`${product.slug}-features`}>Built as part of the Codexyy workflow.</h2>
            <p>{product.summary} No disconnected dashboard or second identity required.</p>
          </div>
          <div className={styles.featureGrid}>
            {product.features.map((feature, index) => (
              <article className={styles.featureCard} key={feature.title}>
                <i>{String(index + 1).padStart(2, '0')}</i>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.workflow} aria-labelledby={`${product.slug}-workflow`}>
          <div className={styles.sectionHead}>
            <span>How it fits</span>
            <h2 id={`${product.slug}-workflow`}>From intent to useful result.</h2>
          </div>
          <ol className={styles.steps}>
            {product.steps.map((step, index) => (
              <li key={step.title}><i>{String(index + 1).padStart(2, '0')}</i><div><h3>{step.title}</h3><p>{step.description}</p></div></li>
            ))}
          </ol>
          {product.command && <div className={styles.command}><span>Terminal</span><code>{product.command}</code><b>↵</b></div>}
        </section>

        <section className={styles.pricing} aria-labelledby={`${product.slug}-pricing`}>
          <div className={styles.priceCard}>
            <div>
              <span className={styles.eyebrow}>Suggested launch price</span>
              <h2 id={`${product.slug}-pricing`}>{product.price}<small>{product.cadence}</small></h2>
              <p>{product.priceDetail}</p>
            </div>
            <button type="button" onClick={joinEarlyAccess} disabled={joining || joined} className={styles.primary}>
              {joined ? 'You’re on the list' : 'Request early access'}
            </button>
          </div>
        </section>

        <section className={styles.family} aria-labelledby="product-family-title">
          <div className={styles.sectionHead}>
            <span>The product family</span>
            <h2 id="product-family-title">Explore everything Codexyy is building.</h2>
          </div>
          <div className={styles.familyGrid}>
            {PRODUCTS.map(item => (
              <a href={`/${item.slug}`} key={item.slug} aria-current={item.slug === product.slug ? 'page' : undefined} className={item.slug === product.slug ? styles.current : ''} style={{ '--item': item.color } as CSSProperties}>
                <span /><strong>{item.shortName}</strong><small>{item.price}</small>
              </a>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
