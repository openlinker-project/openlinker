/**
 * OMS onboarding wizard - mockup baselines (#3458)
 *
 * Serves the REPO-COMMITTED mockup (never the Artifact URL, per
 * `docs/frontend-architecture.md` § UX Mockups), clicks every
 * `mockup-state-chip` and every `mockup-source-chip`, waits for
 * `body[data-state]` and captures one screenshot per state. Needs no stack:
 * the file is opened over `file://`.
 *
 * Every screenshot is attached to the report with the visible `data-testid`s
 * of that state, which is the list `live-states.spec.ts` holds the live
 * wizard to.
 *
 * @module tests/oms-onboarding
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  MOCKUP_STATE_FOR_PRESET,
  MockupPresetValues,
  OmsOnboardingMockupPage,
} from '../../src/pages/oms-onboarding-mockup.page';

async function capture(page: Page, testInfo: TestInfo, name: string, testIds: string[]): Promise<void> {
  const shot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  await testInfo.attach(name, { path: shot, contentType: 'image/png' });
  await testInfo.attach(`${name}.test-ids`, {
    body: JSON.stringify(testIds, null, 2),
    contentType: 'application/json',
  });
}

test.describe('OMS onboarding mockup baselines (#3458)', () => {
  test('should capture one screenshot per data-state when each state chip is clicked', async ({
    page,
  }, testInfo) => {
    const mockup = new OmsOnboardingMockupPage(page);
    for (const preset of MockupPresetValues) {
      const state = MOCKUP_STATE_FOR_PRESET[preset];
      await mockup.show('prestashop', preset, state);
      await capture(page, testInfo, `mockup--${state}`, await mockup.visibleTestIds());
    }
  });

  test('should show the stop dialog state when stop is asked on the status page', async ({
    page,
  }, testInfo) => {
    const mockup = new OmsOnboardingMockupPage(page);
    await mockup.show('prestashop', 'live', 'status-on');
    await mockup.openStopDialog();
    await capture(
      page,
      testInfo,
      'mockup--dialog-stop-confirm',
      await mockup.visibleTestIds(page.getByTestId('dialog-stop-packing')),
    );
  });

  test('should stay on step 1 with no way forward when no product master is connected', async ({
    page,
  }, testInfo) => {
    const mockup = new OmsOnboardingMockupPage(page);
    await mockup.show('none', 's1', 'step-1-no-product-master');
    await expect(page.getByTestId('alert-no-product-master')).toBeVisible();
    await expect(page.getByTestId('link-connect-product-master')).toBeVisible();
    await expect(page.getByTestId('btn-confirm-product-master')).toHaveCount(0);
    await expect(page.getByTestId('btn-continue-step-1')).toHaveCount(0);
    await capture(page, testInfo, 'mockup--step-1-no-product-master', await mockup.visibleTestIds());
  });

  test('should warn about two product masters and still allow confirming them', async ({
    page,
  }, testInfo) => {
    const mockup = new OmsOnboardingMockupPage(page);
    await mockup.show('two', 's1', 'step-1-two-product-masters');
    await expect(page.getByTestId('alert-two-product-masters')).toBeVisible();
    await expect(page.getByTestId('btn-confirm-product-master')).toBeEnabled();
    await capture(page, testInfo, 'mockup--step-1-two-product-masters', await mockup.visibleTestIds());
  });

  test('should render step 1 for every named product master', async ({ page }, testInfo) => {
    const mockup = new OmsOnboardingMockupPage(page);
    for (const source of ['prestashop', 'woocommerce', 'subiekt'] as const) {
      await mockup.show(source, 's1', 'step-1-product-master');
      await capture(page, testInfo, `mockup--step-1-product-master--${source}`, await mockup.visibleTestIds());
    }
  });
});
