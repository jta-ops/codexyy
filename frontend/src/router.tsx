import {
  Children,
  createContext,
  isValidElement,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

type LocationValue = {
  pathname: string
  search: string
  hash: string
  state: unknown
}

type NavigateOptions = { replace?: boolean; state?: unknown }
type Navigate = (to: string | number, options?: NavigateOptions) => void

const currentLocation = (): LocationValue => ({
  pathname: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
  state: history.state?.cxyState ?? null,
})

const RouterContext = createContext<{ location: LocationValue; navigate: Navigate } | null>(null)
const ParamsContext = createContext<Record<string, string>>({})

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation)
  useEffect(() => {
    const update = () => setLocation(currentLocation())
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  const navigate: Navigate = (to, options = {}) => {
    if (typeof to === 'number') {
      history.go(to)
      return
    }
    const target = new URL(to, window.location.href)
    if (target.origin !== window.location.origin) {
      window.location.assign(target.href)
      return
    }
    const href = `${target.pathname}${target.search}${target.hash}`
    const method = options.replace ? 'replaceState' : 'pushState'
    history[method]({ cxyState: options.state ?? null }, '', href)
    setLocation(currentLocation())
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  return <RouterContext.Provider value={{ location, navigate }}>{children}</RouterContext.Provider>
}

function useRouter() {
  const value = useContext(RouterContext)
  if (!value) throw new Error('Router hooks must be used inside BrowserRouter')
  return value
}

export function useLocation() {
  return useRouter().location
}

export function useNavigate() {
  return useRouter().navigate
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string>>() {
  return useContext(ParamsContext) as T
}

export function useSearchParams() {
  const { location, navigate } = useRouter()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const setParams = (next: URLSearchParams | Record<string, string>) => {
    const value = next instanceof URLSearchParams ? next : new URLSearchParams(next)
    navigate(`${location.pathname}?${value.toString()}`, { replace: true })
  }
  return [params, setParams] as const
}

type RouteProps = { path: string; element: ReactElement }

export function Route(_props: RouteProps) {
  return null
}

function matchRoute(pattern: string, pathname: string) {
  if (pattern === '*') return { params: {} }
  const clean = (value: string) => value.replace(/\/+$/, '') || '/'
  const patternParts = clean(pattern).split('/').filter(Boolean)
  const pathParts = clean(pathname).split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]
    const actual = pathParts[index]
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual)
    else if (expected !== actual) return null
  }
  return { params }
}

export function Routes({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  for (const child of Children.toArray(children)) {
    if (!isValidElement<RouteProps>(child)) continue
    const match = matchRoute(child.props.path, pathname)
    if (match) return <ParamsContext.Provider value={match.params}>{child.props.element}</ParamsContext.Provider>
  }
  return null
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string
  state?: unknown
  replace?: boolean
}

export function Link({ to, state, replace, onClick, target, children, ...props }: LinkProps) {
  const navigate = useNavigate()
  const activate = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || target === '_blank') return
    event.preventDefault()
    navigate(to, { state, replace })
  }
  return <a {...props} href={to} target={target} onClick={activate}>{children}</a>
}
