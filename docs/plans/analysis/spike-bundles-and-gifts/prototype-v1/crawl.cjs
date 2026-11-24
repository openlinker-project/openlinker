// Visit every prototype state in light/dark at 1280 and 400 px; report errors, overflow, empty states.
const { chromium } = require('@playwright/test');
(async () => {
  const file = 'file://' + process.argv[2];
  const shots = process.argv[3];
  const only = process.argv[4] ? process.argv[4].split(',') : null;
  const b = await chromium.launch();
  const errs = [];
  let visited = 0;
  const passes = process.env.ALT ? [[1440, 'light', 'alt']] : [[1440, 'light', 'desk'], [400, 'dark', 'mob']];
  for (const [w, scheme, tag] of passes) {
    const p = await b.newPage({ viewport: { width: w, height: 1000 }, colorScheme: scheme });
    p.on('pageerror', (e) => errs.push(`${tag} pageerror ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/backendu|Failed to load resource/.test(m.text())) errs.push(`${tag} console ${m.text().slice(0, 200)}`); });
    await p.goto(file);
    if (tag === 'alt') {
      await p.getByText('OMS włączony').click();
      await p.getByRole('radio', { name: 'EUR' }).first().click().catch(() => p.getByText('EUR', { exact: true }).first().click());
      await p.locator('.proto-bar__role select').selectOption('viewer');
    }
    const states = await p.evaluate(() => window.__PROTO_STATES__);
    for (const s of states) {
      if (only && !only.some((o) => s.startsWith(o))) continue;
      await p.evaluate((h) => { location.hash = h; }, s);
      await p.waitForTimeout(120);
      visited++;
      const len = await p.evaluate(() => (document.querySelector('main')?.innerText ?? '').length);
      if (len < 120) errs.push(`${tag} ${s} short content (${len})`);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ow > 2) errs.push(`${tag} ${s} horizontal overflow ${ow}px`);
      if (shots && (tag === 'desk' || s.endsWith('/' + s.split('/')[1]))) {
        if (process.env.SHOT_ALL || process.argv[5]?.split(',').includes(s)) await p.screenshot({ path: `${shots}/${tag}-${s.replace('/', '__')}.png`, fullPage: true });
      }
    }
    await p.close();
  }
  console.log(`visited ${visited}`);
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close();
})();
