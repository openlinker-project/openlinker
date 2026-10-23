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
 * `gotoState` is called once per state in a loop (`mockup-baselines.spec.ts`),
 * all against the SAME file. Only the FIRST call is a real document load —
 * `ol-kit.js` reads `location.hash` exactly once, in its `DOMContentLoaded`
 * handler, so a later `page.goto()` differing only by fragment must not be
 * relied on to re-run that handler. `ol-kit.js` now also listens for
 * `hashchange` (#3536), and assigning `location.hash` directly is what the
 * spec guarantees fires that event — so every call after the first sets the
 * hash in-page instead of re-navigating, which is both the reliable path and
 * a plain document reload avoided for free.
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
    const fileUrl = `file://${file}`;
    const sameDocumentAlreadyOpen = this.page.url().split('#')[0] === fileUrl;
    if (!sameDocumentAlreadyOpen) {
      // First visit to this file: a real load, so ol-kit.js's own
      // DOMContentLoaded handler reads the initial hash.
      await this.page.goto(`${fileUrl}#${state}`, { waitUntil: 'networkidle' });
    } else {
      // Same document already open (a later state in the same loop): assign
      // `location.hash` directly rather than `page.goto` a fragment-only
      // URL difference — the spec guarantees a `hashchange` fires, which is
      // what ol-kit.js's own listener now reacts to (#3536); relying on
      // `page.goto` here would depend on the browser treating that
      // navigation as same-document, which this does not need to assume.
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
