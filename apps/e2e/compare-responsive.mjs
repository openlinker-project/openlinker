/**
 * Shoots the pack bench and its mockup at tablet and phone widths, and flags
 * horizontal overflow (the failure a desktop-only check never sees).
 */
import { chromium } from 'playwright';
import path from 'node:path';

const BASE = 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots';
const MOCKUP = path.resolve('../../docs/plans/mockups/pack-bench-redesign.html');

const SIZES = [
  { name: 'tablet-1024', width: 1024, height: 1200 },
  { name: 'tablet-834', width: 834, height: 1200 },
  { name: 'tablet-768', width: 768, height: 1200 },
  { name: 'phone-390', width: 390, height: 1400 },
];

const OVERFLOW = `(() => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      const cls = typeof el.className === 'string' ? el.className : '(svg)';
      bad.push({ tag: el.tagName.toLowerCase(), cls: cls.slice(0, 60), left: Math.round(r.left), right: Math.round(r.right) });
    }
  }
  return { vw, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 12) };
})()`;

const browser = await chromium.launch();

for (const size of SIZES) {
  // --- mockup ---
  const mctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const m = await mctx.newPage();
  await m.goto(`file://${MOCKUP}`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(250);
  await m.locator('#themeToggle').click();
  await m.waitForTimeout(250);
  await m.screenshot({ path: `${OUT}/rsp-mockup-${size.name}.png`, fullPage: false });
  await mctx.close();

  // --- app ---
  const actx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  const a = await actx.newPage();
  await a.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await a.getByPlaceholder('Username or email').fill('admin');
  await a.getByPlaceholder('Enter your password').fill('admin');
  await a.locator('button[type="submit"]').first().click();
  await a.waitForTimeout(1500);
  await a.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
  await a.waitForTimeout(1500);
  const open = a.getByRole('button', { name: 'Open parcel' });
  if ((await open.count()) > 0) {
    await open.first().click();
    await a.waitForTimeout(1500);
  }
  await a.screenshot({ path: `${OUT}/rsp-app-${size.name}.png`, fullPage: true });
  const report = await a.evaluate(OVERFLOW);
  console.log(`\n=== ${size.name} (app) vw=${report.vw} scrollW=${report.scrollW}`);
  if (report.scrollW > report.vw + 1) console.log('  HORIZONTAL OVERFLOW');
  for (const b of report.bad) console.log(`  ${b.tag}.${b.cls} [${b.left} .. ${b.right}]`);
  if (report.bad.length === 0) console.log('  no overflowing elements');
  await actx.close();
}

await browser.close();
console.log('\nDONE');
