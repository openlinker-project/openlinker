import { chromium } from 'playwright';

const BASE = 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots';
const SIZES = [
  { name: 'desktop', width: 1440, height: 1100 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'phone', width: 390, height: 844 },
];

const OVERFLOW = `(() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      const cls = typeof el.className === 'string' ? el.className : '(svg)';
      bad.push(el.tagName.toLowerCase() + '.' + cls.slice(0, 50) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
    }
  }
  return { vw, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 10) };
})()`;

const browser = await chromium.launch();
for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: size.name !== 'desktop',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${size.name}] page error`, e.message));

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Username or email').fill('admin');
  await page.getByPlaceholder('Enter your password').fill('admin');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/fulfillment/assign`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/assign-${size.name}.png`, fullPage: true });

  const r = await page.evaluate(OVERFLOW);
  console.log(`\n=== ${size.name} vw=${r.vw} scrollW=${r.scrollW}${r.scrollW > r.vw + 1 ? '  HORIZONTAL OVERFLOW' : ''}`);
  for (const b of r.bad) console.log('  ' + b);
  if (r.bad.length === 0) console.log('  no overflowing elements');

  const lanes = await page.locator('[class*="assign-packing-work-lane"]').count();
  const cards = await page.locator('[class*="assign-packing-work"][draggable]').count();
  console.log(`  lanes: ${lanes}  draggable cards: ${cards}`);
  await ctx.close();
}
await browser.close();
console.log('\nDONE');
