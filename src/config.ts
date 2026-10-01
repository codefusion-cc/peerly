import { APP_ID } from '../shared/app.ts'

export { APP_ID }

declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string

/** The build this page is, shown in settings so anyone can tell what is deployed. */
export const BUILD = Object.freeze({ version: __APP_VERSION__, commit: __APP_COMMIT__ })

/** Builds for the end-to-end tests sign in with the test issuer (`VITE_E2E_AUTH`); never set for a deployment. */
export const E2E_AUTH = import.meta.env.VITE_E2E_AUTH === 'true'

/**
 * The origin whose Worker takes sign-in returns. Providers accept no wildcard
 * redirect, so a branch preview (`<branch>.preview.peerly.cc`) signs in
 * through the stable preview deployment, which hands the token back here.
 */
export function authOrigin(hostname = location.hostname, origin = location.origin): string {
  return /^[a-z0-9-]+\.preview\.peerly\.cc$/.test(hostname) ? 'https://preview.peerly.cc' : origin
}
