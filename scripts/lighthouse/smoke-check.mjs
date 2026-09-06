#!/usr/bin/env node
/**
 * Renders each Lighthouse target route with Playwright and reports whether
 * it produced a real render (heading text found, no error-boundary marker)
 * before any Lighthouse score is trusted for it. Not part of the CI gate —
 * a one-off verification step, kept so the check is reproducible.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173';
const ROUTES = ['/connections', '/customers', '/listings', '/shipments', '/settings'];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  for (const route of ROUTES) {
    consoleErrors.length = 0;
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);
    const bodyText = await page.locator('body').innerText();
    const hasErrorBoundary = /something went wrong|unexpected error|application error/i.test(bodyText);
    const title = await page.title();
    console.log(`\n=== ${route} ===`);
    console.log('title:', title);
    console.log('body text length:', bodyText.length);
    console.log('error-boundary text present:', hasErrorBoundary);
    console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'none');
    console.log('body snippet:', bodyText.slice(0, 300).replace(/\n+/g, ' | '));
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
