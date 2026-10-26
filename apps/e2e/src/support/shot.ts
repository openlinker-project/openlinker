/**
 * Named screenshots for the ksef-legal suite.
 *
 * Every state a reviewer should see is saved under
 * `screenshots/ksef-legal/<area>/<nn>-<state>.png` (gitignored, and outside
 * `test-results/`, which Playwright empties at the start of every run - the
 * suite runs one spec at a time, so shots from earlier specs must survive)
 * and attached to the HTML report.
 *
 * @module support
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';

const ROOT = join(process.cwd(), 'screenshots', 'ksef-legal');

export async function shot(
  target: Page | Locator,
  testInfo: TestInfo,
  name: string
): Promise<string> {
  const path = join(ROOT, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  if ('goto' in target) {
    await target.screenshot({ path, fullPage: true, animations: 'disabled' });
  } else {
    await target.screenshot({ path, animations: 'disabled' });
  }
  await testInfo.attach(name, { path, contentType: 'image/png' });
  return path;
}
