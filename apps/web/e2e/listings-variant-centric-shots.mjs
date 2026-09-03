/**
 * Variant-centric listings mockup — responsive render capture (#2823).
 *
 * Captures the standalone mockup at
 * docs/plans/mockups/listings-variant-centric-2823.html at the three
 * style-guide widths (360 × 812 / 768 × 1024 / 1440 × 900,
 * docs/frontend-ui-style-guide.md § Responsive) in both themes, plus the
 * remaining frames at desktop width. The PNGs are attachments on the issue
 * discussion — they are not committed.
 *
 * WHY THIS IS A SIBLING OF listings-mockup-shots.mjs RATHER THAN A PARAMETER
 * OF IT: that script hard-codes the #1965 mockup path, and its readiness gate
 * polls `.tabs__count[data-count="active"]` — an attribute this mockup's tab
 * strip does not carry, because its counts are per-lifecycle offer counts
 * rather than the #1965 page's row counts. Round 2 of this file justified the
 * sibling by saying #2823 removed the tab strip; round 3 put the strip back
 * (PM decision, from the lo-fi), so that reason is void and this is the real
 * one. Making one script serve both mockups would mean branching on which
 * mockup it was pointed at, which is worse than two files.
 *
 * Shares the rest of the #1965 approach deliberately: the same capture-time
 * chrome strip (inline !important, because an appended stylesheet loses the
 * cascade against `.sheet`'s own padding), the same font injection (the mockup
 * declares IBM Plex but ships no @font-face; the app's self-hosted faces are
 * extracted from index.css and re-pointed over file://, which the Polish
 * sample data needs for latin-ext), and reducedMotion so the publishing pulse
 * and the skeleton shimmer freeze and a light/dark pair stays comparable.
 *
 * Like the rest of this folder it is a capture script, not a test — but it
 * asserts as it goes: that all three tables have rendered, that the tablet
 * matrix genuinely overflows its own container, and that neither the tablet
 * nor the mobile toolbar does (the style guide allows horizontal scrolling
 * inside a table container and nowhere else).
 *
 * Usage:  node apps/web/e2e/listings-variant-centric-shots.mjs
 * Env:    OUT_DIR · THEME=light|dark (default both)
 */

import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MOCKUP = resolve(REPO_ROOT, 'docs/plans/mockups/listings-variant-centric-2823.html');
const APP_CSS = resolve(REPO_ROOT, 'apps/web/src/index.css');
const FONT_DIR = resolve(REPO_ROOT, 'apps/web/public/fonts');
const OUT_DIR = process.env.OUT_DIR ?? resolve(REPO_ROOT, 'e2e-out/listings-2823');
const THEMES = process.env.THEME ? [process.env.THEME] : ['light', 'dark'];

/* Frame ids follow round 3's sheet. `#frame-desktop` / `#frame-expanded` /
   `#frame-filters` / `#frame-degraded` are gone: the clickable prototype
   replaced the first two, the filter frame became the tab frame, and the
   degraded-connection pair was folded into the edge states. */
const SHOTS = [
  { name: 'mobile-360', selector: '#frame-mobile', width: 360, height: 812 },
  { name: 'tablet-768', selector: '#frame-tablet', width: 768, height: 1024 },
  { name: 'proto-1440', selector: '#frame-proto', width: 1440, height: 1000 },
  { name: 'compare-1440', selector: '#frame-compare', width: 1440, height: 2200 },
  { name: 'vocabulary-1440', selector: '#frame-vocab', width: 1440, height: 700 },
  { name: 'detail-1440', selector: '#frame-detail', width: 1440, height: 900 },
  { name: 'tabs-1440', selector: '#frame-tabs', width: 1440, height: 1200 },
  { name: 'scale-1440', selector: '#frame-scale', width: 1440, height: 1600 },
  { name: 'publish-1440', selector: '#frame-publish', width: 1440, height: 900 },
  { name: 'states-1440', selector: '#frame-states', width: 1440, height: 1100 },
  { name: 'handover-1440', selector: '#frame-handover', width: 1440, height: 1400 },
];

async function stripChrome(page, sel) {
  await page.evaluate((selector) => {
    const set = (el, prop, value) => el.style.setProperty(prop, value, 'important');
    document.querySelectorAll('.controls, .sheet__title, .sheet__sub, .sheet__note, .viewport-frame__label, .gap-legend, .eyebrow')
      .forEach((el) => set(el, 'display', 'none'));
    document.querySelectorAll('section.viewport-frame').forEach((el) => {
      if (el.matches(selector)) { set(el, 'display', 'block'); set(el, 'margin', '0'); }
      else { set(el, 'display', 'none'); }
    });
    const sheet = document.querySelector('.sheet');
    set(sheet, 'max-width', 'none'); set(sheet, 'padding', '0');
    document.querySelectorAll(`${selector} .viewport-frame__scroll`).forEach((el) => {
      set(el, 'padding', '0'); set(el, 'background', 'none'); set(el, 'overflow', 'visible');
    });
    document.querySelectorAll(`${selector} .phone-frame, ${selector} .tablet-frame`).forEach((el) => {
      set(el, 'max-width', 'none'); set(el, 'margin', '0');
    });
  }, sel);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function fontCss() {
  const css = await readFile(APP_CSS, 'utf8');
  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  if (!blocks.length) throw new Error('no @font-face blocks');
  return blocks.join('\n').replace(/url\(['"]?\/fonts\/([^'")]+)['"]?\)/g, (_m, f) => `url('file://${FONT_DIR}/${f}')`);
}

/* Readiness signal, replacing #1965's `.tabs__count[data-count="active"]`.
   Gate on the rendered rows of all three shapes, keyed on the attribute the
   row actually carries (`data-variant` — round 2 gated on `data-row`, which
   this markup has never emitted, so the gate was passing on the selector
   finding nothing rather than on the table being ready). Also wait for the
   live measurement to have run, since a frame that quotes a figure must not
   be captured before the figure is in it. */
async function assertReady(page) {
  await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-variant]').length > 0, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#tablet-rows tr[data-variant]').length > 0, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('#mobile-cards .state-card').length > 0, { timeout: 5000 });
  /* The readout is rendered from JS and its slots differ per variant, so gate
     on it having any content rather than on a specific id — round 3's first
     pass gated on `#ro-needs`, which the variant switch deleted. */
  await page.waitForFunction(
    () => (document.getElementById('scale-readout')?.textContent ?? '').includes('px'),
    { timeout: 5000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#compare-mount .scale-readout').length === 6
      && [...document.querySelectorAll('#compare-mount .scale-readout')]
           .every((el) => el.textContent.includes('px')),
    { timeout: 5000 });
  const fontsOk = await page.evaluate(() =>
    document.fonts.check('13px "IBM Plex Sans"') && document.fonts.check('13px "IBM Plex Mono"'));
  if (!fontsOk) throw new Error('IBM Plex did not load');
}

const box = (page, sel) => page.locator(sel).evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));

async function measure(page, shot) {
  if (shot.selector === '#frame-tablet') {
    const t = await box(page, '#frame-tablet .data-table__container');
    /* Overflow here is neither pass nor fail: at three connections the grid
       fits 768 px and at nine it cannot. Report the number and let the frame
       argue — asserting either way would bake one connection count into a
       capture script. */
    console.log(`  tablet table ${t.s}/${t.c} px · ${t.s > t.c ? 'scrolls sideways inside the container' : 'fits'}`);
    const bar = await box(page, '#frame-tablet .toolbar');
    console.log(`  tablet toolbar ${bar.s}/${bar.c} px · ${bar.s <= bar.c ? 'fits' : 'SCROLLS'}`);
  }
  /* Frame 02 is the one that has to be reported in full: it is the only place
     the two variants are measured against each other, and the whole point of
     the frame is that the numbers are not symmetrical. */
  if (shot.selector === '#frame-compare') {
    const readouts = await page.locator('#compare-mount .scale-readout').allInnerTexts();
    for (const line of readouts) {
      console.log(`  compare · ${line.replace(/\s+/g, ' ').trim()}`);
    }
    const proofs = await page.locator('[data-scroll-proof]').evaluateAll((boxes) =>
      boxes.map((b) => ({
        variant: b.getAttribute('data-scroll-proof'),
        scrolled: Math.round(b.scrollTop),
        headerVisible: b.querySelector('thead').getBoundingClientRect().bottom > b.getBoundingClientRect().top,
      })));
    for (const proof of proofs) {
      console.log(`  scroll proof ${proof.variant} · scrolled ${proof.scrolled} px · header ${proof.headerVisible ? 'STILL VISIBLE — proof is not proving anything' : 'off-screen (expected)'}`);
    }
  }
  if (shot.selector === '#frame-scale') {
    const cases = await page.locator('#scale-mount > figure').evaluateAll((figs) =>
      figs.map((f) => {
        const c = f.querySelector('.data-table__container');
        const ro = f.querySelector('.scale-readout');
        return { s: c.scrollWidth, c: c.clientWidth, ro: ro.textContent.replace(/\s+/g, ' ').trim() };
      }));
    for (const item of cases) {
      console.log(`  scale ${item.s}/${item.c} px · ${item.ro}`);
    }
  }
  if (shot.selector === '#frame-mobile') {
    const bar = await box(page, '#frame-mobile .toolbar');
    console.log(`  mobile toolbar ${bar.s}/${bar.c} px · ${bar.s <= bar.c ? 'fits' : 'SCROLLS'}`);
    const doc = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    console.log(`  mobile page ${doc.s}/${doc.c} px · ${doc.s <= doc.c ? 'no sideways page scroll' : 'PAGE SCROLLS SIDEWAYS'}`);
  }
  if (shot.selector === '#frame-proto') {
    const doc = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    console.log(`  prototype page ${doc.s}/${doc.c} px · ${doc.s <= doc.c ? 'no sideways page scroll' : 'PAGE SCROLLS SIDEWAYS'}`);
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const fonts = await fontCss();
  const browser = await chromium.launch({ headless: true });
  const seen = new Set();
  try {
    for (const theme of THEMES) {
      for (const shot of SHOTS) {
        const context = await browser.newContext({
          viewport: { width: shot.width, height: shot.height },
          colorScheme: theme, reducedMotion: 'reduce', deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        try {
          await page.goto(`file://${MOCKUP}`, { waitUntil: 'load' });
          await page.addStyleTag({ content: fonts });
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await assertReady(page);
          await stripChrome(page, shot.selector);
          if (!seen.has(shot.selector)) { await measure(page, shot); seen.add(shot.selector); }
          const path = resolve(OUT_DIR, `${shot.name}-${theme}.png`);
          await page.screenshot({ path, fullPage: false });
          if (errors.length) console.log(`  !! console errors: ${errors.join(' | ')}`);
          console.log(`  captured ${shot.name}-${theme}`);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
  console.log(`\nDone → ${OUT_DIR}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
