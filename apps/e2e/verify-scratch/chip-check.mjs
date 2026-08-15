/** Scratch: confirm `.chip--active` now wins over the tone modifier (#2100 review). */
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: '.auth/admin.json' });
const page = await ctx.newPage();

await page.goto('http://localhost:5273/login');
await page.waitForLoadState('networkidle').catch(() => {});
const user = page.getByLabel(/username or email/i);
if ((await user.count()) > 0) {
  await user.fill('admin');
  await page.getByLabel(/password/i).fill('admin');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
}
await page.goto('http://localhost:5273/orders');

const chip = page.getByRole('button', { name: /invoicing blocked/i });
await chip.waitFor({ timeout: 30000 });

const read = () =>
  chip.evaluate((e) => {
    const s = getComputedStyle(e);
    return { bg: s.backgroundColor, color: s.color, weight: s.fontWeight };
  });

const off = await read();
await chip.click();
await page.waitForTimeout(600);
const on = await read();

console.log('inactive:', JSON.stringify(off));
console.log('active  :', JSON.stringify(on));
console.log('background changed:', off.bg !== on.bg);
console.log('color changed     :', off.color !== on.color);

await browser.close();
