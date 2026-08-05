import { useState, useCallback, lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from './router'
import Loader from './components/Loader'
import { PRODUCTS } from './data/products'
import styles from './App.module.css'

const Home = lazy(() => import('./pages/Home'))
const ProductPage = lazy(() => import('./pages/ProductPage'))
const Intro = lazy(() => import('./pages/Intro'))
const Session = lazy(() => import('./pages/Session'))
const WhatWeDo = lazy(() => import('./pages/WhatWeDo'))
const Playground = lazy(() => import('./pages/Playground'))
const Wallpaper = lazy(() => import('./pages/Wallpaper'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const RepoPlayground = lazy(() => import('./pages/RepoPlayground'))
const Explore = lazy(() => import('./pages/Explore'))
const Setup = lazy(() => import('./pages/Setup'))
const Pro = lazy(() => import('./pages/Pro'))
const Status = lazy(() => import('./pages/Status'))
const Docs = lazy(() => import('./pages/Docs'))
const Changelog = lazy(() => import('./pages/Changelog'))
const Demo = lazy(() => import('./pages/Demo'))
const Terms = lazy(() => import('./pages/Terms'))
const NotFound = lazy(() => import('./pages/NotFound'))
const AgentStart = lazy(() => import('./pages/AgentStart'))
const ArtifactPreview = lazy(() => import('./pages/ArtifactPreview'))

function introSeen() {
  const ts = localStorage.getItem('cxy_intro')
  return !!ts && (Date.now() - Number(ts)) < 30 * 60 * 1000
}

function AppInner() {
  const location = useLocation()
  const fromIntro = !!(location.state as any)?.skipLoader

  const isHomeFresh = location.pathname === '/' && !fromIntro && !introSeen()

  const [loaded, setLoaded] = useState(false)
  const done = useCallback(() => setLoaded(true), [])

  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    main.id = 'main-content'
    main.setAttribute('tabindex', '-1')
    main.focus({ preventScroll: true })
  }, [location.pathname])

  const routes = <Suspense fallback={<div role="status" aria-label="Loading page" style={{ minHeight: '100vh', background: '#07070a' }} />}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/intro" element={<Intro />} />
      <Route path="/play" element={<Playground />} />
      <Route path="/play/:id" element={<Playground />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/repo/:id" element={<RepoPlayground />} />
      <Route path="/explore" element={<Explore />} />
      <Route path="/wallpaper" element={<Wallpaper />} />
      <Route path="/s/:sessionId" element={<Session />} />
      <Route path="/chat/:sessionId" element={<Session />} />
      <Route path="/what-we-do" element={<WhatWeDo />} />
      <Route path="/download" element={<Setup />} />
      <Route path="/pro" element={<Pro />} />
      <Route path="/status" element={<Status />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/changelog" element={<Changelog />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/agent/start" element={<AgentStart />} />
      <Route path="/preview" element={<ArtifactPreview />} />
      {PRODUCTS.map(product => (
        <Route key={product.slug} path={`/${product.slug}`} element={<ProductPage product={product} />} />
      ))}
      <Route path="*" element={<NotFound />} />
    </Routes>
  </Suspense>

  if (isHomeFresh) return <Suspense fallback={<div style={{ minHeight: '100vh', background: '#07070a' }} />}><Intro /></Suspense>
  if (location.pathname !== '/') return routes

  return (
    <>
      {!loaded && <Loader onDone={done} />}
      <div className={loaded ? styles.pageIn : styles.pageHidden}>
        {routes}
      </div>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <AppInner />
    </BrowserRouter>
  )
}
