const { chromium } = require('playwright');
const PS_BASE = 'http://localhost:18080';
const OUT = __dirname + '/screenshots';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await page.goto(PS_BASE + '/admin-dev', { waitUntil: 'load', timeout: 20000 }).catch(async () => {
      await page.goto(PS_BASE, { waitUntil: 'load', timeout: 20000 });
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: OUT + '/PS1-landing.png' });
    console.log('URL:', page.url());
  } finally {
    await browser.close();
  }
})();
