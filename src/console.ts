/**
 * Peerly's pages' side of CodeFusion Console (@codefusion-cc/console, Privacy
 * Policy "Error reports" and "Page views"): error reports, masked before they
 * leave the page, and page views counted without any id of the visitor.
 * Peerly never asks to count visitors apart, so views carry no visitor id.
 */
import { connectBrowser } from '@codefusion-cc/console/browser'
import { APP_ID, BUILD } from './config.ts'
import type { Route } from './router.ts'
import { updates } from './updates.ts'

export const { installBrowserFailureReporting, reportBrowserFailure, setErrorPage, recordView, recordSignIn } =
  connectBrowser({ appId: APP_ID, version: `v${BUILD.version} · ${BUILD.commit}`, updates })

/** The page name a route is counted under (the Worker's CONSOLE_PAGES). */
export const pageOf = (route: Route) => route.name
