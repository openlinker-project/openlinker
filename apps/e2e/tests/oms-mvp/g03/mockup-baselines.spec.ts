/**
 * G03 mockup baselines — one screenshot per declared state (#3536)
 *
 * Serves the REPO-COMMITTED mockups (never the Artifact URL) and captures
 * one screenshot per `data-mk-state` for:
 *   - M3 order notes and tags (#3531/#3532/#3533)
 *   - M5 orders export (#3534/#3535)
 *
 * M4 (orders list with OMS status) is owned by epic #3482, which commits
 * the file; this suite only asserts against it when present, so this file
 * does not fail to run before that epic lands (see `m4MockupFile`'s own
 * docblock). `?search`/`noresults` from that mockup are covered here rather
 * than in a separate file because they are the only M4 states this epic's
 * own scope touches.
 *
 * @module tests/oms-mvp/g03
 */
import { existsSync } from 'node:fs';
import { test, expect } from '../../../src/fixtures/test';
import {
  G03_MOCKUP_FILES,
  M3_STATES,
  M5_STATES,
  M4_SEARCH_STATES,
  m4MockupFile,
  OmsMvpG03MockupPage,
} from '../../../src/pages/oms-mvp-g03-mockup.page';

test.describe('G03 mockup baselines (#3536)', () => {
  test('M3 order notes and tags — one screenshot per state', async ({ page }, testInfo) => {
    const mockup = new OmsMvpG03MockupPage(page);
    for (const state of M3_STATES) {
      await mockup.gotoState(G03_MOCKUP_FILES.m3, state);
      const region = mockup.visibleStateRegion();
      await expect(region).toHaveAttribute('data-mk-state', state);
      const shot = testInfo.outputPath(`m3--${state}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`M3 — ${state}`, { path: shot, contentType: 'image/png' });
    }
  });

  test('M5 orders export — one screenshot per state', async ({ page }, testInfo) => {
    const mockup = new OmsMvpG03MockupPage(page);
    for (const state of M5_STATES) {
      await mockup.gotoState(G03_MOCKUP_FILES.m5, state);
      const region = mockup.visibleStateRegion();
      await expect(region).toHaveAttribute('data-mk-state', state);
      const shot = testInfo.outputPath(`m5--${state}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`M5 — ${state}`, { path: shot, contentType: 'image/png' });
    }
  });

  test('M4 search / noresults — one screenshot each, when #3482 has landed the file', async ({ page }, testInfo) => {
    const file = m4MockupFile();
    test.skip(!existsSync(file), 'M4 mockup not committed yet — owned by epic #3482');
    const mockup = new OmsMvpG03MockupPage(page);
    for (const state of M4_SEARCH_STATES) {
      await mockup.gotoState(file, state);
      const region = mockup.visibleStateRegion();
      await expect(region).toHaveAttribute('data-mk-state', state);
      const shot = testInfo.outputPath(`m4--${state}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`M4 — ${state}`, { path: shot, contentType: 'image/png' });
    }
  });
});
