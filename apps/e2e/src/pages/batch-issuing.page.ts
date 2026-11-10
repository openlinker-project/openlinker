/**
 * Batch issuing page objects (#3585, mockup M15)
 *
 * Two surfaces, one vocabulary. The repo-committed M15 mockup and the live
 * batch screen (#3584) both mark their root with
 * `data-testid="batch-issuing-screen"` and the state they show with
 * `data-mk-state`, and both carry the same element `data-testid`s
 * (`batch-run-now`, `batch-queue-table`, `batch-queue-row`,
 * `batch-run-progress`, `batch-run-history-table`, `batch-run-details`,
 * `batch-run-item`, `batch-unavailable-alert`). That shared vocabulary is what
 * lets a spec drive both into the same named state and compare them.
 *
 * The mockup is read from disk (`file://`), never from the Artifact URL
 * (`docs/frontend-architecture.md` § UX Mockups), and switched with the
 * shared `ol-kit.js` hash switcher through `OmsMvpG03MockupPage.gotoState`.
 *
 * @module pages
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

export const M15_MOCKUP_FILE = resolve(
  HERE,
  '../../../../docs/plans/mockups/oms-mvp/m15-batch-issuing.html'
);

export const M15_STATES = [
  'settings',
  'queue',
  'running',
  'finished',
  'empty',
  'unavailable',
] as const;
export type M15State = (typeof M15_STATES)[number];

/** Element test ids both surfaces carry. Root excluded: every state has it. */
export const M15_ELEMENT_TEST_IDS = [
  'batch-run-now',
  'batch-queue-table',
  'batch-queue-row',
  'batch-run-progress',
  'batch-run-history-table',
  'batch-run-details',
  'batch-run-item',
  'batch-unavailable-alert',
] as const;

export const SCREEN_TEST_ID = 'batch-issuing-screen';

/** The element test ids present inside the visible screen root. */
export async function presentElementTestIds(page: Page): Promise<string[]> {
  const root = page.locator(`[data-testid="${SCREEN_TEST_ID}"]:not([hidden])`);
  const present: string[] = [];
  for (const id of M15_ELEMENT_TEST_IDS) {
    if ((await root.locator(`[data-testid="${id}"]`).count()) > 0) present.push(id);
  }
  return present;
}

export function batchScreenPath(connectionId: string): string {
  return `/settings/sales-documents/batches/${encodeURIComponent(connectionId)}`;
}

export class BatchIssuingPage {
  constructor(private readonly page: Page) {}

  async goto(connectionId: string): Promise<void> {
    await this.page.goto(batchScreenPath(connectionId));
    await expect(this.screen()).toBeVisible();
  }

  screen(): Locator {
    return this.page.getByTestId(SCREEN_TEST_ID);
  }

  async expectState(state: M15State): Promise<void> {
    await expect(this.screen()).toHaveAttribute('data-mk-state', state);
  }

  async openTab(name: 'Schedule' | 'Next batch' | 'Run history'): Promise<void> {
    await this.page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
  }

  runNow(): Locator {
    return this.page.getByTestId('batch-run-now');
  }

  queueRow(orderId: string): Locator {
    return this.page.locator(`[data-testid="batch-queue-row"][data-order-id="${orderId}"]`);
  }

  runItem(orderId: string): Locator {
    return this.page.locator(`[data-testid="batch-run-item"][data-order-id="${orderId}"]`);
  }

  chip(label: RegExp): Locator {
    return this.page.getByRole('button', { name: label });
  }
}
