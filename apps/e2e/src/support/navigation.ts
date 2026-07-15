/**
 * SPA navigation helpers
 *
 * Cold-start-robust navigation for the React SPA. The web container's very first
 * request after a (re)build must fetch, parse and execute the Vite bundle before
 * React commits its first render into `#root` — on a freshly built stack this can
 * comfortably exceed the default `expect` timeout, which manifested as a
 * first-navigation flake that only passed on retry (issue #1513).
 *
 * `gotoWhenAppMounted` fixes this at the root: it navigates, then waits for an
 * *interactive* signal (React has mounted content into `#root`) rather than a
 * fixed sleep or a blanket global-timeout bump. The wait is bounded by a
 * generous cold-start budget that only gates this readiness condition, so a
 * genuinely broken app still fails — it just tolerates a slow first paint.
 *
 * @module support
 */
import type { Page } from '@playwright/test';

/**
 * Cold-start budget for the SPA to fetch/parse/execute its bundle and commit the
 * first render. Generous on purpose: it gates only the "React has mounted"
 * readiness condition on the FIRST navigation against a freshly built container,
 * not per-action or per-assertion latency (those keep the project defaults).
 */
export const APP_MOUNT_TIMEOUT_MS = 60_000;

/**
 * Navigate to `path` and resolve once the SPA is interactive.
 *
 * Waits for the document to be parsed (`domcontentloaded`) and for React to have
 * committed content into the `#root` mount point — a real readiness condition,
 * not a fixed delay. Use for the FIRST navigation of a browser context against a
 * possibly-cold web container; subsequent in-app navigations can use plain
 * `page.goto`.
 */
export async function gotoWhenAppMounted(
  page: Page,
  path: string,
  timeout: number = APP_MOUNT_TIMEOUT_MS
): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout });
  // React mounts into `#root`; a populated root is the interactive signal.
  await page.locator('#root > *').first().waitFor({ state: 'attached', timeout });
}
