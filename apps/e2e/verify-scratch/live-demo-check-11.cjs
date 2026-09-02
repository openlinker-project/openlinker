const { chromium } = require('playwright');
const BASE = 'http://localhost:8090';
const OUT = __dirname + '/screenshots';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 20000 });
  const userField = await page.$('input[name="username"]');
  if (userField) await userField.fill('admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);

  // Use the authenticated browser session to hit the API directly.
  const result = await page.evaluate(async () => {
    const res = await fetch(window.__OL_API_BASE__ ? window.__OL_API_BASE__ + '/v1/orders?limit=200' : 'http://localhost:13000/v1/orders?limit=200', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('accessToken') || localStorage.getItem('ol_access_token') || JSON.parse(localStorage.getItem('auth')||'{}').accessToken || '') } });
    const json = await res.json();
    return json;
  });
  const items = result.items || result.data || result;
  const list = Array.isArray(items) ? items : [];
  const kulus = list.filter(o => JSON.stringify(o).includes('Kulus'));
  console.log('total returned:', list.length);
  console.log('kulus matches:', JSON.stringify(kulus.slice(0, 5).map(o => ({ id: o.id, total: o.total ?? o.totalAmount, status: o.status })), null, 2));

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
