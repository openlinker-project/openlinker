/**
 * G05 mockup-vs-live screenshot pair (#3546)
 *
 * The OMS-MVP mockups are not pixel-identical to the app, so no pixel diff is
 * asserted. Instead, for a state the live app has just been driven to, this
 * attaches the live screenshot and the repo-committed mockup screenshot of the
 * SAME state to the test report, side by side, for a reviewer to compare. The
 * test's real assertions stay on the shared `data-testid` values.
 *
 * @module support
 */
import type { Page, TestInfo } from '@playwright/test';
import { OmsMvpG05MockupPage } from '../pages/oms-mvp-g05-mockup.page';

export interface MockupComparison {
  /** Absolute path of the mockup file (`G05_MOCKUP_FILES.m1` and friends). */
  readonly mockupFile: string;
  /** The `data-mk-state` the live page is showing. */
  readonly mockupState: string;
  /** Short label used in the attachment names, e.g. `M1 cancel-confirm`. */
  readonly label: string;
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

/** Attach `<label> - live` and `<label> - mockup` PNGs to the report. */
export async function attachMockupComparison(
  livePage: Page,
  testInfo: TestInfo,
  comparison: MockupComparison,
): Promise<void> {
  const name = safeName(comparison.label);

  const liveShot = testInfo.outputPath(`${name}--live.png`);
  await livePage.screenshot({ path: liveShot, fullPage: true });
  await testInfo.attach(`${comparison.label} - live`, { path: liveShot, contentType: 'image/png' });

  const mockupPage = await livePage.context().newPage();
  try {
    await new OmsMvpG05MockupPage(mockupPage).gotoState(comparison.mockupFile, comparison.mockupState);
    const mockupShot = testInfo.outputPath(`${name}--mockup.png`);
    await mockupPage.screenshot({ path: mockupShot, fullPage: true });
    await testInfo.attach(`${comparison.label} - mockup`, {
      path: mockupShot,
      contentType: 'image/png',
    });
  } finally {
    await mockupPage.close();
  }
}
