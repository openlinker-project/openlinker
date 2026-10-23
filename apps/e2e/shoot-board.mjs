/**
 * Board screenshots at three widths (#3415), capture-only.
 *
 * Deliberately NOT part of `sweep-fulfillment-states.mjs` - see the same note
 * on `shoot-rail.mjs`: that file makes one assertion per state and fails a run,
 * while this one only captures, and a capture failure must not read as a
 * product regression.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/apw-screenshots/board-polish';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
for (const size of [
  { name: 'desk', width: 1440, height: 1200 },
  { name: 'laptop', width: 1024, height: 1000 },
  { name: 'phone', width: 390, height: 900 },
]) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  await page.goto('http://localhost:38090/login', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Username or email').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(2500);
  await page.goto('http://localhost:38090/fulfillment', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/board-${size.name}.png`, fullPage: false });
  console.log(`  ${size.name} ${OUT}/board-${size.name}.png`);
  await page.close();
}
await browser.close();
