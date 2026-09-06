#!/usr/bin/env node
/**
 * Renders every authenticated `apps/web` route with Playwright and reports
 * whether it produced a real render (no error-boundary marker, no thrown
 * page error) against the same generic network stub Lighthouse audits
 * against — before any Lighthouse score is trusted, and independent of it.
 * Not part of the CI gate — a one-off verification step, kept so the check
 * is reproducible.
 *
 * `ROUTES` is the full authenticated route list from `root.route.tsx`'s
 * `coreChildren` (#2926) — every top-level route the sidebar links to, plus
 * one representative parameterised detail route per list page (a
 * `SMOKE_CHECK_PLACEHOLDER_ID` id, which resolves to nothing under the mock
 * stub — visiting an unknown id in a URL is itself a real, reachable case
 * an operator can hit, e.g. a stale bookmark after a connection is
 * deleted). Plugin-contributed routes (Allegro/Erli category browsers,
 * etc.) are out of scope here — they require a real connection of that
 * platform type to resolve meaningfully and are not part of the generic
 * authenticated surface this check establishes coverage over.
 *
 * `REGRESSION_GUARD_ROUTES` are the two routes #2926 fixed
 * (`analytics-page.tsx`, `settings-page.tsx` and their tiles) — this script
 * exits non-zero if EITHER of them regresses to an error-boundary or a
 * thrown page error, so the fix stays fixed. Every other route is reported
 * but does NOT fail the process: the point of extending coverage to all of
 * them is to make the extent of the "unguarded `.length`/`.find`/`.filter`
 * read" class of bug visible, not to silently gate on fixing every one of
 * them in this change.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173';
const SMOKE_CHECK_PLACEHOLDER_ID = 'smoke-check-placeholder';

const ROUTES = [
  // Post-login landing page (#2740) — also reachable at the legacy
  // `/analytics` redirect, checked alongside it.
  '/',
  '/analytics',
  '/insights',
  '/orders',
  '/products',
  '/cursors',
  '/customers',
  '/listings',
  '/shipments',
  '/returns',
  '/fulfillment',
  '/automations',
  '/invoices',
  '/connections',
  `/connections/${SMOKE_CHECK_PLACEHOLDER_ID}`,
  `/connections/${SMOKE_CHECK_PLACEHOLDER_ID}/mappings`,
  `/connections/${SMOKE_CHECK_PLACEHOLDER_ID}/mappings/categories`,
  `/connections/${SMOKE_CHECK_PLACEHOLDER_ID}/edit`,
  '/connections/new',
  '/connections/new/advanced',
  '/adapters',
  '/jobs-logs',
  '/webhook-deliveries',
  '/settings',
  '/settings/sync-pacing',
  '/settings/sales-documents',
  '/settings/who-decides',
  '/settings/mcp-tokens',
  '/settings/prompt-templates', // legacy redirect -> /ai/prompt-templates
  '/ai/provider-settings',
  '/ai/prompt-templates',
  `/ai/prompt-templates/${SMOKE_CHECK_PLACEHOLDER_ID}`,
  '/users',
  '/dev/ui',
];

const REGRESSION_GUARD_ROUTES = ['/', '/settings'];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const results = [];

  for (const route of ROUTES) {
    consoleErrors.length = 0;
    pageErrors.length = 0;
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (err) {
      results.push({ route, crashed: true, reason: `navigation failed: ${err.message}` });
      console.log(`\n=== ${route} ===`);
      console.log('NAVIGATION FAILED:', err.message);
      continue;
    }
    await page.waitForTimeout(500);
    const bodyText = await page.locator('body').innerText();
    const hasErrorBoundary = /something went wrong|unexpected error|application error/i.test(
      bodyText,
    );
    const crashed = hasErrorBoundary || pageErrors.length > 0;
    const title = await page.title();
    results.push({ route, crashed });

    console.log(`\n=== ${route} ===`);
    console.log('title:', title);
    console.log('body text length:', bodyText.length);
    console.log('error-boundary text present:', hasErrorBoundary);
    console.log('page errors:', pageErrors.length ? pageErrors.slice(0, 3) : 'none');
    console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'none');
    console.log('body snippet:', bodyText.slice(0, 300).replace(/\n+/g, ' | '));
  }

  await browser.close();

  const crashedRoutes = results.filter((r) => r.crashed).map((r) => r.route);
  console.log(`\n=== summary ===`);
  console.log(`${results.length} routes checked, ${crashedRoutes.length} crashed`);
  if (crashedRoutes.length > 0) {
    console.log('crashed routes:', crashedRoutes.join(', '));
  }

  const regressed = REGRESSION_GUARD_ROUTES.filter((route) => crashedRoutes.includes(route));
  if (regressed.length > 0) {
    console.error(
      `\nREGRESSION: ${regressed.join(', ')} crashed against the degraded-data stub — #2926 fixed this.`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
