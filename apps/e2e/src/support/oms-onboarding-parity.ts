/**
 * OMS onboarding mockup parity (#3458)
 *
 * Holds one live wizard state to its mockup counterpart: the mockup is opened
 * in a second tab of the same context, put into the matching state, and every
 * `data-testid` it shows must exist in the live wizard - except the ids
 * `MOCKUP_ONLY_TEST_IDS` names with a reason. Both screenshots are attached
 * side by side under one name so a reviewer compares them in the report.
 *
 * A pixel comparison is deliberately not made: the mockup draws 4 steps and
 * the wizard 7, so the stepper alone differs on every screen.
 *
 * @module support
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  LIVE_STATE_FOR_MOCKUP,
  MOCKUP_ONLY_TEST_IDS,
  OmsOnboardingMockupPage,
  type MockupPreset,
  type MockupSource,
} from '../pages/oms-onboarding-mockup.page';
import type { OmsOnboardingPage } from '../pages/oms-onboarding.page';

export interface ParityTarget {
  source: MockupSource;
  preset: MockupPreset;
  /** The mockup's `data-state` for this preset and source. */
  mockupState: string;
  /** Open the stop dialog on both sides before comparing. */
  dialog?: boolean;
}

async function attachShot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

export async function assertMockupParity(
  live: OmsOnboardingPage,
  livePage: Page,
  target: ParityTarget,
  testInfo: TestInfo,
): Promise<void> {
  const liveState = LIVE_STATE_FOR_MOCKUP[target.mockupState];
  expect(liveState, `no live state mapped for mockup state ${target.mockupState}`).toBeDefined();

  const mockupTab = await livePage.context().newPage();
  try {
    const mockup = new OmsOnboardingMockupPage(mockupTab);
    // The stop dialog carries its own data-state; the page under it stays status-on.
    await mockup.show(target.source, target.preset, target.dialog === true ? 'status-on' : target.mockupState);
    let scope: Locator | undefined;
    if (target.dialog === true) {
      await mockup.openStopDialog();
      scope = mockupTab.getByTestId('dialog-stop-packing');
    }
    const expectedIds = (await mockup.visibleTestIds(scope)).filter((id) => !MOCKUP_ONLY_TEST_IDS.has(id));
    // An empty list would make the comparison pass on nothing.
    expect(expectedIds.length, `mockup ${target.mockupState} shows no test ids`).toBeGreaterThan(0);
    await testInfo.attach(`${target.mockupState}--compared-test-ids`, {
      body: JSON.stringify(expectedIds, null, 2),
      contentType: 'application/json',
    });

    if (target.dialog === true) {
      await expect(livePage.locator('[data-state="dialog-stop-confirm"]')).toBeVisible();
    } else {
      await live.expectState(liveState);
    }

    const liveScope = target.dialog === true ? livePage.getByTestId('dialog-stop-packing') : live.root();
    const missing: string[] = [];
    for (const id of expectedIds) {
      if ((await liveScope.getByTestId(id).count()) === 0 && (await livePage.getByTestId(id).count()) === 0) {
        missing.push(id);
      }
    }

    await attachShot(mockupTab, testInfo, `${target.mockupState}--mockup`);
    await attachShot(livePage, testInfo, `${target.mockupState}--live`);
    expect(missing, `live ${liveState} lacks the mockup's test ids`).toEqual([]);
  } finally {
    await mockupTab.close();
  }
}
