/**
 * Two packers, one box: proves the collision banner really appears, with the
 * masked name the API produced.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots';

const browser = await chromium.launch();

async function signIn(ctx, username, password) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Username or email').fill(username);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(1500);
  return page;
}

// --- packer A signs in ---
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const a = await signIn(ctxA, 'admin', 'admin');

// --- A opens a parcel and notes which one ---
await a.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
await a.waitForTimeout(1200);
await a.getByRole('button', { name: 'Open parcel' }).first().click();
await a.waitForTimeout(1500);
const ref = await a.locator('.bench-parcel__reference').first().innerText();
console.log('A opened:', ref.trim());

// --- B signs in and opens the same one ---
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const b = await signIn(ctxB, 'anna.pakowska', 'Pakowanie!2026');
await b.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
await b.waitForTimeout(1200);
// The SAME box, not merely a box: A's and B's rails are ordered differently.
const target = ref.trim().split('\n')[0];
const row = b.locator('[data-testid="bench-work-row"]', { hasText: target }).first();
console.log('B can see', target, ':', (await row.count()) > 0);
await row.getByRole('button', { name: 'Open parcel' }).click();
await b.waitForTimeout(2000);
console.log('B opened:', (await b.locator('.bench-parcel__reference').first().innerText()).trim().split('\n')[0]);

// --- A polls every 10s; wait one cycle and look ---
await a.waitForTimeout(12000);
const banner = a.locator('[data-testid="bench-collision"]');
const present = (await banner.count()) > 0;
console.log('A sees the banner:', present);
if (present) console.log('banner text:', (await banner.innerText()).replace(/\s+/g, ' '));
await a.screenshot({ path: `${OUT}/collision-banner.png`, fullPage: false });

await browser.close();
console.log('DONE');
