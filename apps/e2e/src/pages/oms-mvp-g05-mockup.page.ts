/**
 * G05 mockup page object (#3546)
 *
 * Drives the repo-committed OMS-MVP mockups M1 (order cancel and edit), M2
 * (buyer message to seller) and M3 (order notes and tags, `bulk` state only)
 * straight off disk via `file://` - never the Claude Artifact URL
 * (`docs/frontend-architecture.md` § UX Mockups).
 *
 * The three files share the `ol-kit.js` switcher the G03 mockups use: each
 * state is a `[data-mk-state="<name>"]` section and `ol-kit.js` reads
 * `location.hash` at load and on `hashchange`. The navigation logic is the
 * same as `OmsMvpG03MockupPage` (first call is a real load, later calls assign
 * `location.hash` in-page) and is repeated rather than imported because that
 * class is pinned to the G03 file table; see its header for the full reasoning.
 *
 * @module pages
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCKUP_ROOT = resolve(HERE, '../../../../docs/plans/mockups/oms-mvp');

export const G05_MOCKUP_FILES = {
  m1: resolve(MOCKUP_ROOT, 'm1-order-cancel-and-edit.html'),
  m2: resolve(MOCKUP_ROOT, 'm2-buyer-message-to-seller.html'),
  m3: resolve(MOCKUP_ROOT, 'm3-order-notes-and-tags.html'),
} as const;

export const M1_STATES = [
  'order',
  'cancel-confirm',
  'cancel-progress',
  'cancel-label',
  'cancel-shipped',
  'cancel-done',
  'edit-form',
  'edit-review',
  'edit-blocked',
  'edit-saved',
] as const;
export type M1State = (typeof M1_STATES)[number];

export const M2_STATES = ['detail', 'long', 'none', 'list', 'bench', 'bench-ack', 'multi'] as const;
export type M2State = (typeof M2_STATES)[number];

/** M3 is owned by G03 except for the bulk bar, which G05 (#3619) implements. */
export const M3_G05_STATES = ['bulk'] as const;
export type M3G05State = (typeof M3_G05_STATES)[number];

export class OmsMvpG05MockupPage {
  constructor(private readonly page: Page) {}

  /** Navigate straight to the named state via the URL hash `ol-kit.js` reads. */
  async gotoState(file: string, state: string): Promise<void> {
    const fileUrl = `file://${file}`;
    const sameDocumentAlreadyOpen = this.page.url().split('#')[0] === fileUrl;
    if (!sameDocumentAlreadyOpen) {
      await this.page.goto(`${fileUrl}#${state}`, { waitUntil: 'networkidle' });
    } else {
      await this.page.evaluate((s) => {
        window.location.hash = s;
      }, state);
    }
    await expect(this.stateRegion(state)).toBeVisible();
  }

  /** The named state's own section, only matched while it is the visible one. */
  stateRegion(state: string): Locator {
    return this.page.locator(`[data-mk-state="${state}"]:not([hidden])`);
  }

  /** The one `[data-mk-state]` section that is not `hidden` right now. */
  visibleStateRegion(): Locator {
    return this.page.locator('[data-mk-state]:not([hidden])');
  }
}
