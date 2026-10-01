/** An invite opened while signed out, kept in this tab until the join page takes it. */
const KEY = 'peerly-pending-invite'

export function rememberInvite(hash: string): void {
  try { sessionStorage.setItem(KEY, hash) } catch { /* The link has to be opened again after signing in. */ }
}

/** What was taken, held for this visit to the join page: a screen that renders twice reads it twice. */
let held: string | null = null

/** The invite fragment this page was opened with, or the one waiting from before signing in. */
export function takeInviteHash(): string {
  if (location.hash.startsWith('#invite=')) {
    held = location.hash
    // Out of the address bar and history: the link is a key to the workspace.
    history.replaceState(null, '', location.pathname)
    return held
  }
  if (held !== null) return held
  try {
    held = sessionStorage.getItem(KEY) ?? ''
    sessionStorage.removeItem(KEY)
  } catch {
    held = ''
  }
  return held
}

/** The invite was used (or left): the next visit to the join page reads afresh. */
export function forgetInvite(): void {
  held = null
}

/** The invite this page holds (to keep it through signing in as someone else). */
export const inviteHash = () => held ?? ''
