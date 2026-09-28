/**
 * The committed mockups, one screenshot per declared state.
 *
 * The other half of a mockup-parity comparison: `sweep-fulfillment-states.mjs`
 * captures what the product does, this captures what it was asked to do. Both
 * write a manifest with the same shape so a report can put them side by side
 * without either side being re-described by hand.
 *
 * The states come from each mockup's own switcher (`[data-state-btn]`), not
 * from a list kept here — a state added to a mockup is captured without
 * anybody remembering to add it, and a state removed stops being claimed.
 *
 *   node apps/e2e/shoot-mockup-states.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ROOT = new URL('../../docs/plans/mockups/', import.meta.url).pathname;
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '/tmp/apw-screenshots/mockup';

const MOCKUPS = [
  { id: 'pack-bench', file: 'pack-bench-redesign.html', title: 'Pack bench redesign' },
  { id: 'assign', file: 'assign-packing-work.html', title: 'Assign packing work' },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const captured = [];

for (const mockup of MOCKUPS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  await page.goto(`file://${ROOT}${mockup.file}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const states = await page.$$eval('[data-state-btn]', (buttons) =>
    buttons.map((b) => ({
      key: b.getAttribute('data-state-btn') ?? '',
      label: (b.textContent ?? '').trim(),
    }))
  );

  if (states.length === 0) {
    // No switcher: the mockup is a single state. Say so rather than recording
    // nothing, which would read as a mockup with no states at all.
    const shot = `${OUT}/${mockup.id}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    captured.push({ mockup: mockup.id, title: mockup.title, state: null, label: 'Single state', screenshot: shot });
    console.log(`  ok  ${mockup.id} (no state switcher)`);
  } else {
    for (const state of states) {
      await page.click(`[data-state-btn="${state.key}"]`);
      await page.waitForTimeout(500);
      const shot = `${OUT}/${mockup.id}--${state.key}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      captured.push({
        mockup: mockup.id,
        title: mockup.title,
        state: state.key,
        label: state.label,
        screenshot: shot,
      });
      console.log(`  ok  ${mockup.id} · ${state.key} — ${state.label}`);
    }
  }

  await ctx.close();
}

await browser.close();
await writeFile(`${OUT}/manifest.json`, JSON.stringify(captured, null, 2));
console.log(`\n  ${String(captured.length)} state(s)\n  manifest: ${OUT}/manifest.json`);
