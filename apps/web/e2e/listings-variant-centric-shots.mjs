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
 * asserts as it goes: that all three tables have rendered, that the mapping
 * card's eight fields are in it, that the measured figures the handover's
 * style-guide entry quotes have actually been computed, and that neither the
 * tablet nor the mobile toolbar scrolls sideways (the style guide allows
 * horizontal scrolling inside a table container and nowhere else).
 *
 * Round 4 changed what the tablet frame asserts. Round 3 required that frame's
 * table to overflow its own container, which was the correct check for a grid
 * of one column per connection; the surviving design is `table-layout: fixed`
 * and cannot overflow sideways, so the assertion is inverted — overflow there
 * would now mean something is broken — and row height is reported instead,
 * since that is the dimension this row actually pays in.
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

/* Frame ids follow round 4's sheet. Gone since round 2: `#frame-desktop` /
   `#frame-expanded` / `#frame-filters` / `#frame-degraded` — the clickable
   prototype replaced the first two, the filter frame became the tab frame,
   and the degraded-connection pair was folded into the edge states. Gone in
   round 4: `#frame-scale`, which drew the rejected column grid's width cliff
   and its priced menu of ways past it; with the grid gone the frame had no
   subject, and the measurement it justified survives in `#frame-compare`.
   New in round 4: `#frame-mapping`, the destination the expansion's rows
   navigate to.

   `height` is the VIEWPORT, and the capture is clipped to it — so a frame
   whose argument is taller than its height loses the bottom of that argument
   silently. Round 4 measured every frame after stripping the chrome and sized
   them from that, which turned up three that had been truncating (`states`
   lost a whole figure at 1100) and one that was 1100 px of white space
   (`handover`, whose body is `.gap-legend` prose the strip hides — the shot
   captures its style-guide entry and nothing else, which is what it is for).
   The two device frames keep their real viewports (812 / 1024) rather than
   their content height: a phone shot that is 941 px tall is not a phone.
   `proto` likewise stays at a genuine 1000 px desktop viewport — it is a page
   view, and the list below the fold is meant to be below the fold. */
const SHOTS = [
  { name: 'mobile-360', selector: '#frame-mobile', width: 360, height: 812 },
  { name: 'tablet-768', selector: '#frame-tablet', width: 768, height: 1024 },
  { name: 'proto-1440', selector: '#frame-proto', width: 1440, height: 1000 },
  { name: 'compare-1440', selector: '#frame-compare', width: 1440, height: 2800 },
  { name: 'vocabulary-1440', selector: '#frame-vocab', width: 1440, height: 700 },
  { name: 'detail-1440', selector: '#frame-detail', width: 1440, height: 1000 },
  { name: 'mapping-1440', selector: '#frame-mapping', width: 1440, height: 560 },
  { name: 'tabs-1440', selector: '#frame-tabs', width: 1440, height: 1200 },
  { name: 'publish-1440', selector: '#frame-publish', width: 1440, height: 1620 },
  { name: 'states-1440', selector: '#frame-states', width: 1440, height: 1470 },
  { name: 'handover-1440', selector: '#frame-handover', width: 1440, height: 340 },
];

async function stripChrome(page, sel) {
  await page.evaluate((selector) => {
    const set = (el, prop, value) => el.style.setProperty(prop, value, 'important');
    /* `.eyebrow` was on this list and should never have been: the frame
       NUMBERS are `.eyebrow-mono` inside `.viewport-frame__label`, which is
       hidden on its own line above, and the only `.eyebrow` in the whole
       sheet is the page header's own — `Operations` on the listings page,
       `Listings` on the mapping card. Hiding it removed a real part of the
       screen from every capture. */
    document.querySelectorAll('.controls, .sheet__title, .sheet__sub, .sheet__note, .viewport-frame__label, .gap-legend')
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
  /* The readout is rendered from JS and its slots differ per screen, so gate
     on it having any content rather than on a specific id — round 3's first
     pass gated on `#ro-needs`, which a later change deleted. */
  await page.waitForFunction(
    () => (document.getElementById('scale-readout')?.textContent ?? '').includes('px'),
    { timeout: 5000 });
  /* THREE, not six: round 3 measured two variants at each of the three
     connection counts. One design survives, so one figure per count. */
  await page.waitForFunction(
    () => document.querySelectorAll('#compare-mount .scale-readout').length === 3
      && [...document.querySelectorAll('#compare-mount .scale-readout')]
           .every((el) => el.textContent.includes('px')),
    { timeout: 5000 });
  /* The mapping card is static markup filled from the fixture, so gating on
     its own field list is what says the frame is drawn at all. */
  await page.waitForFunction(
    () => document.querySelectorAll('#mapping-app .key-value-list__value').length === 8,
    { timeout: 5000 });
  const fontsOk = await page.evaluate(() =>
    document.fonts.check('13px "IBM Plex Sans"') && document.fonts.check('13px "IBM Plex Mono"'));
  if (!fontsOk) throw new Error('IBM Plex did not load');
}

const box = (page, sel) => page.locator(sel).evaluate((el) => ({ s: el.scrollWidth, c: el.clientWidth }));

async function measure(page, shot) {
  if (shot.selector === '#frame-tablet') {
    /* Round 3 measured this container's sideways overflow, which was the
       right number for a grid. The surviving table is `table-layout: fixed`
       and cannot overflow sideways, so the number to report at 768 px is what
       DOES give: row height. Overflow is still printed, but as an assertion
       that it is absent rather than as a figure the frame argues about. */
    const t = await box(page, '#frame-tablet .data-table__container');
    const rows = await page.locator('#tablet-rows tr[data-variant]').evaluateAll((trs) =>
      trs.map((tr) => Math.round(tr.getBoundingClientRect().height)));
    console.log(`  tablet rows ${Math.min(...rows)}–${Math.max(...rows)} px tall across ${rows.length} rows`);
    console.log(`  tablet table ${t.s}/${t.c} px · ${t.s > t.c ? 'SCROLLS SIDEWAYS — fixed layout should make this impossible' : 'no sideways overflow (expected)'}`);
    const bar = await box(page, '#frame-tablet .toolbar');
    console.log(`  tablet toolbar ${bar.s}/${bar.c} px · ${bar.s <= bar.c ? 'fits' : 'SCROLLS'}`);
  }
  /* Frame 02 is the one that has to be reported in full: it carries the row
     heights the handover's style-guide entry quotes, so a capture run is also
     how those numbers get read. Round 3 compared two variants here; one
     survives, so there is one proof panel and one figure per connection
     count. */
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
    if (proofs.length !== 1) {
      console.log(`  scroll proof · expected 1 panel, found ${proofs.length}`);
    }
    for (const proof of proofs) {
      console.log(`  scroll proof · scrolled ${proof.scrolled} px · header ${proof.headerVisible ? 'STILL VISIBLE — the panel is not scrolled far enough to prove anything' : 'off-screen (expected)'}`);
    }
  }
  /* The expansion's rows navigate, so the thing worth asserting is that they
     navigate to DIFFERENT places. The first fixture that fed them hashed only
     the first four characters of its seed, so every row in an expansion
     carried the same mapping id — four listings drawn, one destination, and
     nothing on screen looked wrong. Distinctness is cheap to check and
     impossible to eyeball. */
  if (shot.selector === '#frame-detail') {
    const links = await page.locator('#detail-mount a.data-table__row-link').evaluateAll((as) =>
      as.map((a) => a.getAttribute('href')));
    const distinct = new Set(links).size;
    console.log(`  detail rows · ${links.length} link(s) → ${distinct} distinct target(s)`
      + `${links.length === distinct ? '' : ' · DUPLICATE TARGETS — the fixture is collapsing mappings'}`);
  }
  /* The mapping card carries no measurement — it is a transcription. What is
     worth reporting is that the header the whole trip is named after actually
     rendered, because `stripChrome` used to hide `.eyebrow` and this is the
     frame where that mattered. */
  if (shot.selector === '#frame-mapping') {
    const head = await page.locator('#mapping-app').evaluate((el) => ({
      eyebrow: el.querySelector('.eyebrow')?.textContent ?? '(missing)',
      title: el.querySelector('.page-title')?.textContent ?? '(missing)',
      back: el.querySelector('.back-link__label')?.textContent ?? '(missing)',
      fields: el.querySelectorAll('.key-value-list__label').length,
    }));
    console.log(`  mapping card · back "${head.back}" · eyebrow "${head.eyebrow}" · title "${head.title}" · ${head.fields} fields`);
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
    /* The coverage count and the strip state the same fact twice — one as a
       number, one as a list — so they can drift, and a drifted count is worse
       than none: it is a figure an operator would act on. Assert per row that
       the numerator equals the number of pills the strip drew. */
    const counts = await page.locator('#rows tr[data-variant]').evaluateAll((rows) =>
      rows.map((tr) => {
        const text = tr.querySelector('.coverage-count-col span')?.textContent ?? '';
        const strip = tr.querySelector('.coverage-pills');
        const drawn = strip
          ? (strip.querySelector('.coverage-pill--none') ? 0 : strip.children.length)
          : 0;
        return { text, listed: Number(text.split('/')[0]), drawn };
      }));
    const drifted = counts.filter((c) => c.listed !== c.drawn);
    console.log(`  coverage counts · ${counts.length} row(s) checked · `
      + (drifted.length === 0
          ? 'every numerator matches its strip'
          : `DRIFT: ${drifted.map((c) => `${c.text} vs ${c.drawn} pills`).join(', ')}`));
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
