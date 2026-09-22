/**
 * Pack-bench redesign mockup page object (#3338/#3342)
 *
 * Drives the REPO-COMMITTED mockup file directly off disk
 * (`docs/plans/mockups/pack-bench-redesign.html`) via a `file://` URL — never
 * a Claude Artifact URL, matching `AnalyticsMockupPage`'s own hard rule. Each
 * `data-state` is a `<div data-state="…">` inside `<main class="panel">`,
 * switched by clicking `[data-state-btn="…"]` in the mockup's own state
 * switcher strip; `locked` is a full-screen overlay layered on top rather
 * than an inner panel swap.
 *
 * @module pages
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

export const PACK_BENCH_MOCKUP_FILE_PATH = resolve(
  HERE,
  '../../../../docs/plans/mockups/pack-bench-redesign.html',
);

/** Every `data-state-btn` the mockup's nav strip lists, in that order. */
export const PACK_BENCH_MOCKUP_STATES = [
  'working',
  'ready',
  'unlabelled',
  'hold',
  'empty',
  'locked',
] as const;

export type PackBenchMockupState = (typeof PACK_BENCH_MOCKUP_STATES)[number];

export class PackBenchMockupPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`file://${PACK_BENCH_MOCKUP_FILE_PATH}`);
    await expect(this.page.locator('main [data-state="working"]')).toBeVisible();
  }

  async gotoState(state: PackBenchMockupState): Promise<void> {
    if (!this.page.url().startsWith('file://')) {
      await this.goto();
    }
    await this.page.locator(`[data-state-btn="${state}"]`).click();
    if (state === 'locked') {
      await expect(this.page.locator('#lockOverlay')).toBeVisible();
      return;
    }
    await expect(this.page.locator(`main [data-state="${state}"]`)).toBeVisible();
  }

  /** The region to screenshot for `state`. */
  regionFor(state: PackBenchMockupState): Locator {
    if (state === 'locked') return this.page.locator('#lockOverlay');
    return this.page.locator(`main [data-state="${state}"]`);
  }
}
