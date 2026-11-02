/**
 * G10 mockup baselines - one screenshot per M15 state (#3585)
 *
 * Serves the REPO-COMMITTED mockup (never the Artifact URL) and captures one
 * screenshot per `data-mk-state`. Each state section is also checked to carry
 * the screen root test id, so the live spec can name the same thing.
 *
 * @module tests/oms-mvp/g10
 */
import { test, expect } from '../../../src/fixtures/test';
import { OmsMvpG03MockupPage } from '../../../src/pages/oms-mvp-g03-mockup.page';
import { M15_MOCKUP_FILE, M15_STATES, SCREEN_TEST_ID } from '../../../src/pages/batch-issuing.page';

test.describe('G10 mockup baselines (#3585)', () => {
  test('M15 batch issuing - one screenshot per state', async ({ page }, testInfo) => {
    const mockup = new OmsMvpG03MockupPage(page);
    for (const state of M15_STATES) {
      await mockup.gotoState(M15_MOCKUP_FILE, state);
      const region = mockup.visibleStateRegion();
      await expect(region).toHaveAttribute('data-mk-state', state);
      await expect(region).toHaveAttribute('data-testid', SCREEN_TEST_ID);
      const shot = testInfo.outputPath(`m15--${state}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`M15 - ${state}`, { path: shot, contentType: 'image/png' });
    }
  });
});
