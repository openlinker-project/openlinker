const { chromium } = require('playwright');
const OUT = __dirname + '/screenshots';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyYmViNWMxYS04MTM5LTRmODYtYTExZC1hOGVmZGJhMjAxMTAiLCJ1c2VybmFtZSI6ImFkbWluQG9wZW5saW5rZXIubG9jYWwiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3ODgzNzgxODQsImV4cCI6MTc4ODM5MjU4NH0.iBGXYu2N7VIO71tLhkvcHQJMX2zudfULgB0zREBNTwY';
const ORDER_ID = 'ol_order_8488e406f9f04b04ac5b64961dd9c672';

(async () => {
  const browser = await chromium.launch({ args: ['--disable-web-security'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1800 } });
    const page = await context.newPage();
    await page.route('**/v1/auth/refresh', route => route.fulfill({ json: { access_token: TOKEN } }));
    await page.route('**/v1/auth/me', route => route.fulfill({ json: {
      id: '2beb5c1a-8139-4f86-a11d-a8efdba20110', username: 'admin@openlinker.local',
      email: 'admin@openlinker.local', role: 'admin', permissions: []
    } }));
    await page.addInitScript((t) => { localStorage.setItem('access_token', t); }, TOKEN);
    await page.goto('http://localhost:8090/orders/' + ORDER_ID, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    await context.storageState({ path: OUT + '/../ol-admin-state.json' });
    await page.screenshot({ path: OUT + '/C1-us-order-unresolved.png', fullPage: true });
    console.log('done, url:', page.url());
  } finally {
    await browser.close();
  }
})();
