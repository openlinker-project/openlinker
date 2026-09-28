/**
 * G03 mockup page object (#3536)
 *
 * Drives the three repo-committed OMS-MVP mockups directly off disk via a
 * `file://` URL — never the Claude Artifact URL. Unlike the `analytics-*`
 * mockup family (`data-state` + a `[data-goto]` click), M3/M4/M5 use the
 * shared `ol-kit.js` switcher: each state is a `[data-mk-state="<name>"]`
 * section, and `ol-kit.js` reads `location.hash` at load to pick which one
 * is visible (`ol-kit.js`'s own `bar()` function) — so navigating straight
 * to `file://…#<state>` selects it with no extra click.
 *
 * @module pages
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCKUP_ROOT = resolve(HERE, '../../../../docs/plans/mockups/oms-mvp');

export const G03_MOCKUP_FILES = {
  m3: resolve(MOCKUP_ROOT, 'm3-order-notes-and-tags.html'),
  m5: resolve(MOCKUP_ROOT, 'm5-orders-export.html'),
} as const;

export const M3_STATES = [
  'default',
  'empty',
  'add',
  'tags',
  'filtered',
  'bulk',
  'viewer',
  'bench',
] as const;
export type M3State = (typeof M3_STATES)[number];

export const M5_STATES = [
  'default',
  'selected',
  'preparing',
  'ready',
  'large',
  'background',
  'error',
  'viewer',
] as const;
export type M5State = (typeof M5_STATES)[number];

/**
 * M4 (orders list with OMS status) is owned by epic #3482 and committed by
 * that epic, not this one — see #3529's own dependency note. Its file path
 * is resolved lazily (not exported as a top-level constant) so this module
 * does not fail to import before #3482 lands the file.
 */
export function m4MockupFile(): string {
  return resolve(MOCKUP_ROOT, 'm4-orders-list-with-oms-status.html');
}
export const M4_SEARCH_STATES = ['search', 'noresults'] as const;
export type M4SearchState = (typeof M4_SEARCH_STATES)[number];

export class OmsMvpG03MockupPage {
  constructor(private readonly page: Page) {}

  /** Navigate straight to the named state via the URL hash `ol-kit.js` reads at load. */
  async gotoState(file: string, state: string): Promise<void> {
    await this.page.goto(`file://${file}#${state}`, { waitUntil: 'networkidle' });
    // ol-kit.js reads location.hash synchronously in its own DOMContentLoaded
    // handler, so no extra click/wait is needed once the load event settles.
    await expect(this.visibleStateRegion()).toBeVisible();
  }

  /** The one `[data-mk-state]` section that is not `hidden` right now. */
  visibleStateRegion(): Locator {
    return this.page.locator('[data-mk-state]:not([hidden])');
  }
}
