/**
 * G05 mockup baselines - one screenshot per declared state (#3546)
 *
 * Serves the REPO-COMMITTED mockups (never the Artifact URL) and captures one
 * screenshot per `data-mk-state` for:
 *   - M1 order cancel and edit (#3541/#3544)
 *   - M2 buyer message to seller (#3539/#3543)
 *   - M3 order notes and tags, `bulk` state only (#3619)
 *
 * @module tests/oms-mvp/g05
 */
import { test, expect } from '../../../src/fixtures/test';
import {
  G05_MOCKUP_FILES,
  M1_STATES,
  M2_STATES,
  M3_G05_STATES,
  OmsMvpG05MockupPage,
} from '../../../src/pages/oms-mvp-g05-mockup.page';

test.describe('G05 mockup baselines (#3546)', () => {
  test('should capture one screenshot per state when M1 order cancel and edit is opened', async ({
    page,
  }, testInfo) => {
    const mockup = new OmsMvpG05MockupPage(page);
    for (const state of M1_STATES) {
      await mockup.gotoState(G05_MOCKUP_FILES.m1, state);
      await expect(mockup.visibleStateRegion()).toHaveAttribute('data-mk-state', state);
      const shot = testInfo.outputPath(`m1--${state}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`M1 - ${state}`, { path: shot, contentType: 'image/png' });
    }
  });

  test('should capture one screenshot per state when M2 buyer message to seller is opened', async ({
    page,
  }, testInfo) => {
    const mockup = new OmsMvpG05MockupPage(page);
    for (const state of M2_STATES) {
      await mockup.gotoState(G05_MOCKUP_FILES.m2, state);
      await expect(mockup.visibleStateRegion()).toHaveAttribute('data-mk-state', state);
      const shot = testInfo.outputPath(`m2--${state}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`M2 - ${state}`, { path: shot, contentType: 'image/png' });
    }
  });

  test('should capture the bulk bar state when M3 order notes and tags is opened', async ({
    page,
  }, testInfo) => {
    const mockup = new OmsMvpG05MockupPage(page);
    for (const state of M3_G05_STATES) {
      await mockup.gotoState(G05_MOCKUP_FILES.m3, state);
      await expect(mockup.visibleStateRegion()).toHaveAttribute('data-mk-state', state);
      const shot = testInfo.outputPath(`m3--${state}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`M3 - ${state}`, { path: shot, contentType: 'image/png' });
    }
  });
});
