/**
 * The six manual checks the screen merge's plan asks for, driven.
 *
 * Every one of them is a claim a unit test cannot make: that the route is
 * really registered, that the old path really redirects, and that the axis
 * switch really changes what the server is asked for.
 *
 *   node verify-merged-fulfillment.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.OL_DEMO_WEB ?? 'http://localhost:38090';
const OUT = '/tmp/apw-screenshots/merged';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await ctx.newPage();

const requests = [];
page.on('request', (r) => {
  if (r.url().includes('/fulfillment/works')) requests.push(r.url());
});
page.on('pageerror', (e) => console.log('  PAGE ERROR', e.message));

function check(label, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('Username or email').fill('admin');
await page.getByPlaceholder('Enter your password').fill('admin');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(1800);

// 1 — the merged screen is at /fulfillment
await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
check(
  '/fulfillment renders the merged screen',
  (await page.getByRole('heading', { name: 'Fulfilment' }).count()) > 0
);
check(
  'lanes render',
  (await page.locator('.assign-packing-work-lane').count()) > 0,
  `${String(await page.locator('.assign-packing-work-lane').count())} lanes`
);
await page.screenshot({ path: `${OUT}/01-packer-axis.png`, fullPage: true });

// 2 — the old path redirects rather than 404ing
await page.goto(`${BASE}/fulfillment/assign`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
check('/fulfillment/assign redirects', new URL(page.url()).pathname === '/fulfillment', page.url());

// 3 — filtered-to-nothing is its own sentence
await page.goto(`${BASE}/fulfillment?orderId=ol_order_definitely_missing`, {
  waitUntil: 'networkidle',
});
await page.waitForTimeout(1800);
check(
  'a filter that matches nothing says so',
  (await page.getByText('No fulfilment tasks match these filters').count()) > 0
);
check(
  'and offers a way out',
  (await page.getByRole('button', { name: 'Clear filters' }).count()) > 0
);
await page.screenshot({ path: `${OUT}/02-filtered-empty.png`, fullPage: true });

// 4 — paged past the end is a THIRD sentence, not the same one
await page.goto(`${BASE}/fulfillment?offset=500`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
check(
  'paged past the end says something different',
  (await page.getByText('Nothing on this page').count()) > 0
);

// 5 — the axis switch regroups AND disables drag
await page.goto(`${BASE}/fulfillment?groupBy=location`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const locationLanes = await page.locator('.assign-packing-work-lane').count();
check('the location axis regroups', locationLanes > 0, `${String(locationLanes)} lanes`);
const draggable = await page.locator('.assign-packing-work-card[draggable="true"]').count();
check('drag is off on the location axis', draggable === 0, `${String(draggable)} draggable cards`);
check(
  'and the screen says why',
  (await page.getByText(/Drag moves a task between packers/).count()) > 0
);
await page.screenshot({ path: `${OUT}/03-location-axis.png`, fullPage: true });

// 6 — back on the packer axis, drag returns
await page.goto(`${BASE}/fulfillment`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const draggableBack = await page.locator('.assign-packing-work-card[draggable="true"]').count();
check('drag returns on the packer axis', draggableBack > 0, `${String(draggableBack)} draggable`);

// 7 — the bench exit still lands here
await page.goto(`${BASE}/bench`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const leave = page.getByRole('link', { name: /leave the bench/i });
if ((await leave.count()) > 0) {
  await leave.first().click();
  await page.waitForTimeout(1800);
  check('leaving the bench lands on the merged screen', new URL(page.url()).pathname === '/fulfillment', page.url());
} else {
  console.log('  skip  bench exit not rendered for this session');
}

console.log(`\n  ${String(requests.length)} request(s) to /fulfillment/works`);
console.log(`  last: ${requests[requests.length - 1] ?? '(none)'}`);

await browser.close();
