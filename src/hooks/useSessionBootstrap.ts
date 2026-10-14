import { useEffect, useState } from 'react'
import { base64UrlToBytes } from '@peerly/core'
import { deriveUserId } from '../collab/userId'
import { isE2eAuthBypass } from '../collab/e2eAuth'
import { WorkspaceAuthManager } from '../collab/workspaceAuth'
import {
  hydrateSessionAvatar,
  loadIdentityEmail,
  loadIdentityProvider,
  loadIdentityUserId,
  loadIdToken,
  loadSession,
  migrateLegacySession,
  migrateSessionWorkspaceRouteId,
  saveIdCredentials,
  saveIdentityName,
  saveSession,
  type Session,
} from '../session'
import { migrateWorkspaceRouteIds } from '../collab/workspaceStore'
import { DeviceIdentity } from '../collab/deviceIdentity'
import { ensureOidcAvatar } from '../collab/avatarService'
import { settleGoogleAtLoad } from '../auth/googleRedirect'

/**
 * A return from Google is stored before the first render, so nobody sees the login screen flash; or the page leaves
 * to refresh an aging Google token (auth/googleRedirect). True when it leaves: the page shows nothing until it is
 * back.
 */
async function settleGoogleSignIn(): Promise<boolean> {
  if (isE2eAuthBypass()) return false
  const settled = await settleGoogleAtLoad({
    deviceKeyId: await new DeviceIdentity().publicKeyId(),
    token: loadIdToken(),
    providerId: loadIdentityProvider(),
    email: loadIdentityEmail(),
  })
  if (settled.kind === 'stored') {
    const { credential } = settled
    await ensureOidcAvatar(credential.picture)
    saveIdCredentials(credential.token, 'google', credential.email, await deriveUserId(credential.iss, credential.sub))
    saveIdentityName(credential.name)
  }
  return settled.kind === 'leaving'
}

/**
 * Everything that has to be true before the first render decides anything.
 *
 * This runs once and answers one question — what does this browser already
 * know about who is signed in — from four different eras of how that was
 * stored. Each backfill below exists because a real session got stuck without
 * it, and none is reachable from the others, which is why they are steps
 * rather than branches.
 *
 * `ready` gates rendering rather than the session being non-null: a browser
 * with no session is a legitimate answer, and rendering the join screen
 * before this finishes would flash it at someone who is signed in.
 */
export type SessionBootstrap = {
  session: Session | null
  setSession: React.Dispatch<React.SetStateAction<Session | null>>
  /** False until the questions above are answered, either way. */
  ready: boolean
}

/** The opaque user id derived from a token this app already verified. */
async function userIdFromToken(token: string): Promise<string | null> {
  try {
    const claims = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(token.split('.')[1] ?? ''))
    ) as { iss?: unknown; sub?: unknown }
    if (typeof claims.iss !== 'string' || typeof claims.sub !== 'string') return null
    return await deriveUserId(claims.iss, claims.sub)
  } catch {
    // Malformed token — leave the user id unset; re-auth restores it.
    return null
  }
}

/**
 * E2E keeps a silent mint so a reload does not drop the tester back at
 * sign-in. Guarded by the same build-time flag as the rest of the bypass.
 */
async function remintForE2e(loaded: Session): Promise<void> {
  const manager = new WorkspaceAuthManager({
    workspaceId: loaded.workspaceId,
    creatorKeyId: loaded.creatorKeyId,
    allowList: loaded.allowList,
  })
  await manager.signInWithE2eEmail(loaded.identityEmail)
  const token = manager.getIdToken()
  if (!token) return
  saveIdCredentials(token, loaded.identityProvider, loaded.identityEmail, loaded.identityUserId)
  saveSession(loaded)
}

export function useSessionBootstrap(): SessionBootstrap {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      await migrateLegacySession()
      await migrateSessionWorkspaceRouteId()
      await migrateWorkspaceRouteIds()
      if (await settleGoogleSignIn()) {
        // Back from Google by the Back button, this load comes out of the back-forward cache never having rendered:
        // load it again (the try is recorded, so it does not leave a second time).
        window.addEventListener('pageshow', event => { if (event.persisted) location.reload() }, { once: true })
        return
      }

      // A session without a live token is still a session: the user lands back
      // in their workspace and the ReauthBanner ('expired' phase) handles
      // getting a fresh token for new handshakes.
      const loaded = loadSession()
      if (loaded && !loadIdToken() && isE2eAuthBypass()) await remintForE2e(loaded)

      // Older sessions predate durable identity metadata. Backfill the user id
      // while the verified workspace session and live token are both present,
      // so leaving the workspace can still render the Home/DM experience.
      const liveToken = loadIdToken()
      if (loaded?.identityUserId && liveToken && !loadIdentityUserId()) {
        saveIdCredentials(liveToken, loaded.identityProvider, loaded.identityEmail, loaded.identityUserId)
      }

      // A signed-in user with no workspace has no stored session to backfill
      // from, so if the opaque user id is still missing — localStorage cleared
      // while a token lingered in sessionStorage — derive it from the live
      // token's already-verified claims. Without it the lobby profile stays
      // null and Home wrongly falls through to the create-workspace screen.
      const provider = loadIdentityProvider()
      const email = loadIdentityEmail()
      if (liveToken && provider && email && !loadIdentityUserId()) {
        const userId = await userIdFromToken(liveToken)
        if (userId) saveIdCredentials(liveToken, provider, email, userId)
      }

      if (loaded) setSession(await hydrateSessionAvatar(loaded))
      setReady(true)
    })()
  }, [])

  return { session, setSession, ready }
}
