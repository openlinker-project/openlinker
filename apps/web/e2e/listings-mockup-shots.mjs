/**
 * Listings redesign mockup — responsive render capture (#1965).
 *
 * Captures the three style-guide widths (360 × 812 / 768 × 1024 / 1440 × 900,
 * docs/frontend-ui-style-guide.md § Responsive) from the standalone mockup at
 * docs/plans/mockups/listings-redesign-1965.html, in both themes. The PNGs are
 * attachments on the PR discussion — they are not committed.
 *
 * DEPARTURE FROM THIS FOLDER'S PRECONDITIONS: every other script here drives a
 * running app at WEB_BASE and needs the API plus a logged-in admin. This one
 * loads a single self-contained HTML file over file:// — no server, no stack,
 * no login. There is no WEB_BASE and no OL_ADMIN_*.
 *
 * Three things are not obvious and are deliberate:
 *
 *  1. Each shot runs at its REAL viewport (360 × 812, …), and a capture-time
 *     stylesheet strips the mockup's own sheet chrome so the target frame fills
 *     that viewport. Without the strip the frames are fixed-width boxes inside a
 *     1320px sheet, and an element screenshot of the desktop frame would be
 *     ~1240px wide and thousands tall — neither 1440 nor 900. The mockup file is
 *     never modified; the override lives only in the browser session.
 *  2. The mockup declares IBM Plex but ships no @font-face. This script injects
 *     the app's own self-hosted faces (extracted from apps/web/src/index.css,
 *     re-pointed at apps/web/public/fonts over file://) so the renders use the
 *     real typeface — including latin-ext, which the Polish sample data needs.
 *  3. reducedMotion freezes the skeleton shimmer AND the ACTIVATING badge pulse,
 *     which is in the desktop and tablet shots. Without it a light/dark pair is
 *     not comparable. Cost: the pulse renders at its terminal keyframe.
 *
 * Like the rest of this folder it is a capture script, not a test — but like
 * connection-enable.mjs it asserts as it goes: it verifies render() has filled
 * the tab counts, that the tablet table genuinely overflows its container, and
 * that the tablet tab row genuinely does not.
 *
 * Usage:  node apps/web/e2e/listings-mockup-shots.mjs
 * Env:    OUT_DIR (default e2e-out/listings-1965) · THEME=light|dark|both
 *         (default both) · HEADED=1 to watch
 */

import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const MOCKUP = resolve(REPO_ROOT, 'docs/plans/mockups/listings-redesign-1965.html');
const APP_CSS = resolve(REPO_ROOT, 'apps/web/src/index.css');
const FONT_DIR = resolve(REPO_ROOT, 'apps/web/public/fonts');

const OUT_DIR = process.env.OUT_DIR ?? resolve(REPO_ROOT, 'e2e-out/listings-1965');
const THEMES = process.env.THEME === 'light' || process.env.THEME === 'dark'
  ? [process.env.THEME]
  : ['light', 'dark'];

/** The width in each name is the SIMULATED page width the frame stands for. */
const SHOTS = [
  { name: 'mobile-360', selector: '#frame-mobile', width: 360, height: 812 },
  { name: 'tablet-768', selector: '#frame-tablet', width: 768, height: 1024 },
  { name: 'desktop-1440', selector: '#frame-desktop', width: 1440, height: 900 },
];

/**
 * Strip the design-sheet chrome so the target frame fills the real viewport.
 *
 * Applied as inline styles rather than an injected stylesheet: an appended
 * <style> loses the cascade here in ways that are not worth diagnosing (the
 * .sheet padding override silently failed to win, leaving the frame 80px
 * narrower than the viewport and the renders quietly wrong). An inline
 * !important declaration cannot be outranked, so the strip is deterministic.
 *
 * Capture-only — the mockup file is never modified.
 */
async function stripChrome(page, selector) {
  await page.evaluate((sel) => {
    const set = (el, prop, value) => el.style.setProperty(prop, value, 'important');

    document
      .querySelectorAll('.controls, .sheet__title, .sheet__sub, .sheet__note, .viewport-frame__label')
      .forEach((el) => set(el, 'display', 'none'));

    document.querySelectorAll('section.viewport-frame').forEach((el) => {
      if (el.matches(sel)) {
        set(el, 'display', 'block');
        set(el, 'margin', '0');
      } else {
        set(el, 'display', 'none');
      }
    });

    const sheet = document.querySelector('.sheet');
    set(sheet, 'max-width', 'none');
    set(sheet, 'padding', '0');

    document.querySelectorAll(`${sel} .viewport-frame__scroll`).forEach((el) => {
      set(el, 'padding', '0');
      set(el, 'background', 'none');
      set(el, 'overflow', 'visible');
    });

    document.querySelectorAll(`${sel} .phone-frame, ${sel} .tablet-frame`).forEach((el) => {
      set(el, 'max-width', 'none');
      set(el, 'margin', '0');
    });
  }, selector);
}

/** Extract the app's @font-face blocks and re-point them at the repo over file://. */
async function fontCss() {
  const css = await readFile(APP_CSS, 'utf8');
  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  if (blocks.length === 0) {
    throw new Error(`No @font-face blocks found in ${APP_CSS} — fonts would silently fall back.`);
  }
  return blocks
    .join('\n')
    .replace(/url\(['"]?\/fonts\/([^'")]+)['"]?\)/g, (_m, file) => `url('file://${FONT_DIR}/${file}')`);
}

async function assertReady(page) {
  await page.waitForFunction(
    () => document.querySelector('.tabs__count[data-count="active"]')?.textContent !== '0',
    { timeout: 5000 },
  );

  const fontsOk = await page.evaluate(() =>
    document.fonts.check('13px "IBM Plex Sans"') && document.fonts.check('13px "IBM Plex Mono"'),
  );
  if (!fontsOk) {
    throw new Error('IBM Plex did not load — every render would be in a fallback face.');
  }

  const tabletRows = await page.locator('#tablet-rows tr').count();
  if (tabletRows < 1) {
    throw new Error('#tablet-rows is empty — the tablet rows IIFE did not run.');
  }
}

/**
 * Measure the tablet frame's two responsive claims. These numbers are the point
 * of the frame: they turn "six columns scroll rather than being crushed" from an
 * assertion into something the reviewer can audit.
 */
async function measureTablet(page) {
  // Measured on the elements themselves rather than through a document-wide
  // evaluate: the latter reported pre-strip geometry even when called after the
  // strip, which would have put wrong numbers in the PR comment.
  const read = (selector) =>
    page.locator(selector).evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));

  const m = {
    table: await read('#frame-tablet .data-table__container'),
    tabs: await read('#frame-tablet .tabs__list'),
  };

  if (!m.table || !m.tabs) throw new Error('Tablet frame is missing its table container or tab list.');
  if (m.table.scrollWidth <= m.table.clientWidth) {
    throw new Error(
      `Tablet table does NOT overflow (scrollWidth ${m.table.scrollWidth} <= clientWidth ${m.table.clientWidth}). ` +
      'The frame no longer demonstrates the parity-matrix scroll behaviour.',
    );
  }
  if (m.tabs.scrollWidth > m.tabs.clientWidth) {
    throw new Error(
      `Tablet tab row scrolls (scrollWidth ${m.tabs.scrollWidth} > clientWidth ${m.tabs.clientWidth}). ` +
      'The four lifecycle tabs no longer fit at 768px.',
    );
  }

  console.log(
    `  measured · table ${m.table.scrollWidth}/${m.table.clientWidth} px (overflow ` +
    `${m.table.scrollWidth - m.table.clientWidth}) · tabs ${m.tabs.scrollWidth}/${m.tabs.clientWidth} px (fits)`,
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const fonts = await fontCss();

  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  let measured = false;

  try {
    for (const theme of THEMES) {
      for (const shot of SHOTS) {
        const context = await browser.newContext({
          viewport: { width: shot.width, height: shot.height },
          colorScheme: theme,
          reducedMotion: 'reduce',
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();

        try {
          await page.goto(`file://${MOCKUP}`, { waitUntil: 'load' });
          await page.addStyleTag({ content: fonts });
          await page.evaluate(() => document.fonts.ready);
          // Set the attribute rather than clicking #theme-toggle: the toggle is a
          // relative flip, so it depends on what the boot guard already decided.
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
          await assertReady(page);

          await stripChrome(page, shot.selector);

          // Measure AFTER the strip: only then is the frame at the true viewport
          // width, so the numbers describe the image we are about to write.
          if (!measured && shot.selector === '#frame-tablet') {
            await measureTablet(page);
            measured = true;
          }

          const path = resolve(OUT_DIR, `listings-1965-${shot.name}-${theme}.png`);
          await page.screenshot({ path, fullPage: false });
          console.log(`  captured ${shot.name}-${theme} → ${path}`);

          // Bonus: the tablet table scrolled right, proving the four off-screen
          // columns are intact rather than crushed.
          if (shot.selector === '#frame-tablet') {
            await page.evaluate(() => {
              const el = document.querySelector('#frame-tablet .data-table__container');
              el.scrollLeft = el.scrollWidth;
            });
            const scrolledPath = resolve(OUT_DIR, `listings-1965-tablet-768-scrolled-${theme}.png`);
            await page.screenshot({ path: scrolledPath, fullPage: false });
            console.log(`  captured tablet-768-scrolled-${theme} → ${scrolledPath}`);
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone. ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
