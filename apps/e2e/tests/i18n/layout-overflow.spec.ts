/**
 * Interface language - layout overflow pass (#3859, ADR-079)
 *
 * Opens the screens operators use every day in Polish and in the
 * development-only pseudo-language (`?lang=xx`, English made ~40% longer)
 * and fails when a control's text no longer fits its box. Character budgets
 * in the copy files guess at width; this measures it in a real browser.
 *
 * Read-only: navigates and measures, changes nothing.
 *
 * Elements that truncate on purpose (nav labels, with the full text on
 * hover) are not measured. The pseudo pass skips itself on a production
 * build, where `?lang=xx` is ignored.
 *
 * Run: pnpm --filter @openlinker/e2e exec playwright test --project=setup --project=i18n
 */
import { test, expect } from '../../src/fixtures/test';

const SCREENS = ['/', '/orders', '/listings', '/products', '/connections'];

// Controls whose text must fit: buttons, table headers, badges, chips, the
// language switch itself.
const MEASURED = [
  'button:not(.shell-nav__link)',
  'th',
  '.status-badge',
  '.chip',
  '.context-chip',
  '.language-switch__trigger',
].join(', ');

async function overflowingControls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        offenders.push(`${el.tagName.toLowerCase()}.${el.className} "${el.innerText.trim().slice(0, 60)}"`);
      }
    }
    return offenders;
  }, MEASURED);
}

for (const lang of ['pl', 'xx'] as const) {
  test.describe(`layout in ${lang}`, () => {
    for (const path of SCREENS) {
      test(`${path} fits its controls`, async ({ page }) => {
        const separator = path.includes('?') ? '&' : '?';
        await page.goto(`${path}${separator}lang=${lang}`);
        await page.waitForLoadState('networkidle');
        if (lang === 'xx') {
          const pseudoActive = await page.locator('text=/\\[.*~+\\]/').first().isVisible().catch(() => false);
          test.skip(!pseudoActive, 'pseudo-language only exists in development builds');
        }
        expect(await overflowingControls(page)).toEqual([]);
      });
    }
  });
}
