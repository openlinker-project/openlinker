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
 * Each screen is measured in English first, and only controls that overflow
 * in the other language but fit in English fail, so an overflow or a
 * deliberate ellipsis that predates translation is not blamed on it. Elements
 * that truncate on purpose (nav labels, with the full text on hover) are not
 * measured. The pseudo pass reads the `data-pseudo-locale` marker that
 * `LocaleProvider` sets on `<html>`, and skips only when it is absent, which
 * happens on a production build where `?lang=xx` is ignored.
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

/**
 * Indexes of measured controls whose text does not fit. A control is named by
 * its position among the measured ones, so the same control matches across
 * languages even though its text differs.
 */
async function overflowingControls(
  page: import('@playwright/test').Page,
): Promise<Map<number, string>> {
  const found = await page.evaluate((selector) => {
    const offenders: Array<[number, string]> = [];
    Array.from(document.querySelectorAll<HTMLElement>(selector)).forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (el.scrollWidth > el.clientWidth + 1) {
        offenders.push([
          index,
          `${el.tagName.toLowerCase()}.${el.className} "${el.innerText.trim().slice(0, 60)}"`,
        ]);
      }
    });
    return offenders;
  }, MEASURED);
  return new Map(found);
}

async function open(page: import('@playwright/test').Page, path: string, lang: string): Promise<void> {
  const separator = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${separator}lang=${lang}`);
  await page.waitForLoadState('networkidle');
}

test('the overflow check catches a control that does not fit', async ({ page }) => {
  await open(page, '/', 'en');
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'A label far too long for its button';
    button.style.cssText = 'width: 40px; white-space: nowrap; overflow: hidden;';
    document.body.appendChild(button);
  });
  const offenders = [...(await overflowingControls(page)).values()];
  expect(offenders.some((text) => text.includes('A label far too long'))).toBe(true);
});

for (const lang of ['pl', 'xx'] as const) {
  test.describe(`layout in ${lang}`, () => {
    for (const path of SCREENS) {
      test(`${path} fits its controls`, async ({ page }) => {
        await open(page, path, 'en');
        const baseline = await overflowingControls(page);

        await open(page, path, lang);
        if (lang === 'xx') {
          const marker = await page.evaluate(() => document.documentElement.dataset.pseudoLocale);
          test.skip(marker !== 'true', 'pseudo-language only exists in development builds');
        }
        const offenders = [...(await overflowingControls(page)).entries()]
          .filter(([index]) => !baseline.has(index))
          .map(([, text]) => text);
        expect(offenders).toEqual([]);
      });
    }
  });
}
