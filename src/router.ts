import { useSyncExternalStore } from 'react'

/** The page a URL shows. Workspaces are named by this device's own id for them, never their secret. */
export type Route =
  | { name: 'signin' }
  | { name: 'home' }
  | { name: 'workspace'; workspaceId: string; channelId?: string }
  | { name: 'join' }
  | { name: 'settings'; section: 'account' | 'devices' | 'appearance' | 'storage' }
  | { name: 'legal'; document: 'privacy' | 'terms' }
  | { name: 'not-found' }

const ID = /^[A-Za-z0-9_-]{8,64}$/
const SECTIONS = ['account', 'devices', 'appearance', 'storage'] as const

/** The route a path names. */
export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return { name: 'home' }
  const [first, second, third, fourth] = parts
  if (first === 'signin' && parts.length === 1) return { name: 'signin' }
  if (first === 'join' && parts.length === 1) return { name: 'join' }
  if (first === 'w' && second && ID.test(second)) {
    if (parts.length === 2) return { name: 'workspace', workspaceId: second }
    if (third === 'c' && fourth && ID.test(fourth) && parts.length === 4) return { name: 'workspace', workspaceId: second, channelId: fourth }
  }
  if (first === 'settings') {
    if (parts.length === 1) return { name: 'settings', section: 'account' }
    if (parts.length === 2 && (SECTIONS as readonly string[]).includes(second)) return { name: 'settings', section: second as typeof SECTIONS[number] }
  }
  if (first === 'privacy' && parts.length === 1) return { name: 'legal', document: 'privacy' }
  if (first === 'terms' && parts.length === 1) return { name: 'legal', document: 'terms' }
  return { name: 'not-found' }
}

/** The path for a route. */
export function routePath(route: Route): string {
  switch (route.name) {
    case 'signin': return '/signin'
    case 'home': return '/'
    case 'workspace': return route.channelId ? `/w/${route.workspaceId}/c/${route.channelId}` : `/w/${route.workspaceId}`
    case 'join': return '/join'
    case 'settings': return route.section === 'account' ? '/settings' : `/settings/${route.section}`
    case 'legal': return `/${route.document}`
    case 'not-found': return '/'
  }
}

const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
if (typeof window !== 'undefined') window.addEventListener('popstate', notify)

/** Goes to a route, adding to history (or replacing the current entry). The fragment is kept only when asked. */
export function navigate(route: Route | string, { replace = false, hash = '' } = {}): void {
  const path = typeof route === 'string' ? route : routePath(route)
  const target = `${path}${hash}`
  if (`${location.pathname}${location.hash}` === target) return
  if (replace) history.replaceState(null, '', target)
  else history.pushState(null, '', target)
  notify()
}

/** The current route; the component renders again when it changes. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener) }, () => location.pathname, () => '/')
  return parseRoute(pathname)
}

/** The URL's fragment (`#create`, an invite); the component renders again when it changes. */
export function useHash(): string {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    window.addEventListener('hashchange', listener)
    return () => { listeners.delete(listener); window.removeEventListener('hashchange', listener) }
  }, () => location.hash, () => '')
}
