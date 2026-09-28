/**
 * Rail screenshots at three widths (#3415).
 *
 * The rail now leads with what is in the box rather than with the order
 * reference, so it needs looking at on the hardware a bench actually runs on:
 * a desk, a tablet propped on a packing table, and a phone in a hand.
 *
 * Deliberately NOT part of `sweep-fulfillment-states.mjs`: that file makes one
 * assertion per state and fails a run, while this one only captures. Folding a
 * capture-only pass into it would let a screenshot script failure read as a
 * product regression.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots/rail-redesign';
const WIDTHS = [
  { name: 'desk', width: 1440, height: 1100 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const size of WIDTHS) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Username or email').fill('anna.pakowska');
  await page.getByPlaceholder('Enter your password').fill('Pakowanie!2026');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
  // Long enough for the authenticated thumbnails to resolve - they are fetched
  // as blobs rather than served straight off an <img src>, so a shot taken too
  // early captures the fallback letters and proves nothing about the photos.
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/rail-${size.name}.png`, fullPage: false });
  console.log(`  ${size.name.padEnd(7)} ${OUT}/rail-${size.name}.png`);
  await page.close();
}
await browser.close();
