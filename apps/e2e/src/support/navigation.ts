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
import type { Locator, Page } from '@playwright/test';

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
 * Waits for the document to be parsed (`domcontentloaded`), for React to have
 * committed content into the `#root` mount point, and then for the session
 * bootstrap to settle — real readiness conditions, not fixed delays. Use for the
 * FIRST navigation of a browser context against a possibly-cold web container;
 * subsequent in-app navigations can use plain `page.goto`.
 *
 * The bootstrap wait matters because a populated `#root` is NOT yet the page:
 * both layouts render a `LoadingState` placeholder while `useSession()` resolves
 * (`guest-layout.tsx` "Checking session state...", `authenticated-app-layout.tsx`
 * "Loading application shell"). Returning at `#root > *` handed the caller a
 * spinner, so the caller's first assertion had only the ordinary 15 s `expect`
 * budget to cover the remaining cold-start work — the residual first-navigation
 * flake left over after issue #1513.
 */
export async function gotoWhenAppMounted(
  page: Page,
  path: string,
  options: { readyLocator?: Locator; timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout ?? APP_MOUNT_TIMEOUT_MS;
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout });
  // React mounts into `#root`; a populated root is the interactive signal.
  await page.locator('#root > *').first().waitFor({ state: 'attached', timeout });
  // Then let the session-bootstrap placeholder clear, if one is showing. Not
  // every route renders one, so this is a detach-if-present wait, not a
  // requirement: `waitFor({ state: 'detached' })` resolves immediately when the
  // locator matches nothing.
  await page
    .locator('.state-card--loading')
    .first()
    .waitFor({ state: 'detached', timeout })
    .catch(() => {
      // A page that legitimately keeps a loading card up (a slow data query
      // below the shell) is not a navigation failure — the caller's own
      // assertions decide. Swallow and hand control back.
    });

  // `readyLocator` is the only wait that is actually specific to the requested
  // route, and it is what closes the residual flake: the two waits above can
  // BOTH be satisfied before the route's own content exists (the loading card
  // is a detach-if-present wait, so on a cold container it can resolve
  // instantly, before the placeholder has even rendered). Handing control back
  // there leaves the caller's first assertion running on the ordinary 15 s
  // `expect` budget against a still-painting SPA. Pass the element that proves
  // the ROUTE rendered and it gets the full cold-start budget instead.
  if (options.readyLocator) {
    await options.readyLocator.first().waitFor({ state: 'visible', timeout });
  }
}
