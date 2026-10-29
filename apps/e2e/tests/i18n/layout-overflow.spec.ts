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
 * (or wrap onto a second line) in the other language but not in English fail, so an overflow or a
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

interface Measure {
  text: string;
  height: number;
  overflows: boolean;
}

/**
 * Every visible measured control, keyed so the same control matches across
 * languages even though its text differs: `data-testid` when it has one,
 * otherwise tag, classes and its position among controls of that same
 * signature. A differing count of one kind of control then shifts only that
 * kind, not every control after it.
 */
async function measureControls(
  page: import('@playwright/test').Page,
): Promise<Map<string, Measure>> {
  const found = await page.evaluate((selector) => {
    const seen = new Map<string, number>();
    const out: Array<[string, Measure]> = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const signature = el.dataset.testid ?? `${el.tagName.toLowerCase()}.${el.className}`;
      const position = seen.get(signature) ?? 0;
      seen.set(signature, position + 1);
      out.push([
        `${signature}#${position}`,
        {
          text: `${signature} "${el.innerText.trim().slice(0, 60)}"`,
          height: Math.round(rect.height),
          overflows: el.scrollWidth > el.clientWidth + 1,
        },
      ]);
    }
    return out;
  }, MEASURED);
  return new Map(found);
}

/** A control that wraps onto another line grows by about a line height. */
const WRAP_TOLERANCE_PX = 6;

/**
 * Controls that no longer fit: their text overflows the box, or the box grew
 * taller than it was in the baseline language (the text wrapped). Controls
 * that already overflowed in the baseline are not blamed on the translation.
 */
function newProblems(baseline: Map<string, Measure>, other: Map<string, Measure>): string[] {
  const problems: string[] = [];
  for (const [key, now] of other) {
    const before = baseline.get(key);
    if (!before) continue;
    if (now.overflows && !before.overflows) problems.push(`overflows: ${now.text}`);
    else if (now.height > before.height + WRAP_TOLERANCE_PX) {
      problems.push(`wraps (${before.height}px -> ${now.height}px): ${now.text}`);
    }
  }
  return problems;
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
  const measured = [...(await measureControls(page)).values()];
  expect(measured.some((m) => m.overflows && m.text.includes('A label far too long'))).toBe(true);
});

for (const lang of ['pl', 'xx'] as const) {
  test.describe(`layout in ${lang}`, () => {
    for (const path of SCREENS) {
      test(`${path} fits its controls`, async ({ page }) => {
        await open(page, path, 'en');
        const baseline = await measureControls(page);

        await open(page, path, lang);
        if (lang === 'xx') {
          const marker = await page.evaluate(() => document.documentElement.dataset.pseudoLocale);
          test.skip(marker !== 'true', 'pseudo-language only exists in development builds');
        }
        expect(newProblems(baseline, await measureControls(page))).toEqual([]);
      });
    }
  });
}
