/**
 * G10 live screen states vs mockup (#3585)
 *
 * Drives the live batch screen (#3584) into each M15 state and compares it
 * with the committed mockup in the same state: the screen root reports the
 * same `data-mk-state`, and the same element `data-testid`s are present. One
 * screenshot per state is attached beside the mockup's for a visual check.
 *
 * The screen's reads are stubbed (see `support/batch-issuing-stubs.ts` for
 * why), so this runs on any stack; the real round trip is the golden path.
 *
 * @module tests/oms-mvp/g10
 */
import { test, expect } from '../../../src/fixtures/test';
import { OmsMvpG03MockupPage } from '../../../src/pages/oms-mvp-g03-mockup.page';
import {
  BatchIssuingPage,
  M15_MOCKUP_FILE,
  M15_STATES,
  presentElementTestIds,
} from '../../../src/pages/batch-issuing.page';
import {
  STUB_CONNECTION_ID,
  TAB_FOR_STATE,
  stubBatchIssuingState,
} from '../../../src/support/batch-issuing-stubs';

test.describe('G10 live batch screen matches M15 (#3585)', () => {
  for (const state of M15_STATES) {
    test(`reaches "${state}" with the mockup's test ids`, async ({ page, browser }, testInfo) => {
      // The mockup's element ids for this state, read off the committed file.
      const mockupPage = await browser.newPage();
      const mockup = new OmsMvpG03MockupPage(mockupPage);
      await mockup.gotoState(M15_MOCKUP_FILE, state);
      const expected = await presentElementTestIds(mockupPage);
      await mockupPage.close();

      await stubBatchIssuingState(page, state);
      const screen = new BatchIssuingPage(page);
      await screen.goto(STUB_CONNECTION_ID);
      if (TAB_FOR_STATE[state] !== 'Schedule') {
        await screen.openTab(TAB_FOR_STATE[state]);
      }

      await screen.expectState(state);
      await expect.poll(() => presentElementTestIds(page)).toEqual(expected);

      const shot = testInfo.outputPath(`live--${state}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await testInfo.attach(`Live - ${state}`, { path: shot, contentType: 'image/png' });
    });
  }

  test('the queue filters by kind and by blocked, locally', async ({ page }) => {
    await stubBatchIssuingState(page, 'queue');
    const screen = new BatchIssuingPage(page);
    await screen.goto(STUB_CONNECTION_ID);
    await screen.openTab('Next batch');

    await expect(page.getByTestId('batch-queue-row')).toHaveCount(5);
    await screen.chip(/^Invoice · 2$/).click();
    await expect(page.getByTestId('batch-queue-row')).toHaveCount(2);
    await screen.chip(/^Blocked · 1$/).click();
    await expect(screen.queueRow('ol_order_g10_8')).toContainText(
      'Already has a document on another connection.'
    );
  });
});
