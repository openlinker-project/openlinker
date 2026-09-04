/**
 * Analytics mockup page object (#2482)
 *
 * Drives the REPO-COMMITTED mockup file directly off disk
 * (`docs/plans/mockups/analytics-display-currency-picker.html`) via a
 * `file://` URL — never a Claude Artifact URL, per the issue's own hard
 * requirement. The mockup is a static, single-page HTML document: every
 * `data-state` is a set of elements toggled by a body-level
 * `data-state="<name>"` attribute (see the file's own trailing `<script>`),
 * switched by clicking the `[data-goto="<name>"]` nav button in its state
 * switcher strip.
 *
 * There is deliberately no fixture/seeding concern here — the mockup carries
 * its own hardcoded numbers (see the file for the copy each state renders).
 * This page object only knows how to reach a state and hand back the region
 * to screenshot; comparing that screenshot/content against the real app is
 * the spec's job.
 *
 * @module pages
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the repo-committed mockup, resolved from this file's own location. */
export const MOCKUP_FILE_PATH = resolve(
  HERE,
  '../../../../docs/plans/mockups/analytics-display-currency-picker.html',
);

/**
 * Every `data-state` the mockup defines, in the order its own nav strip
 * lists them (source of truth per the issue: `grep -oE 'data-state="[^"]+"'`
 * against the mockup file). Kept as a literal array rather than derived at
 * runtime so a spec iterating states doesn't depend on the mockup's DOM
 * having loaded first, and so a mockup edit that silently drops a state is a
 * visible diff here rather than a silently-shrunk test list.
 */
export const MOCKUP_STATES = [
  'native',
  'converting',
  'converted',
  'unavailable',
  'settings-open',
  'all-clear',
  'detail-currency',
  'currency-in-progress',
  'currency-fixed',
  'currency-failed',
  'detail-tax',
  'tax-confirm',
  'detail-novat',
  'detail-postrollout',
  'detail-mapping',
] as const;

export type MockupState = (typeof MOCKUP_STATES)[number];

export class AnalyticsMockupPage {
  constructor(private readonly page: Page) {}

  /**
   * Opens the mockup file fresh and lands on `native`.
   *
   * The mockup's `<body>` carries NO `data-state` attribute at load — it is
   * set only by the nav-strip click handler and by each dialog's own "Close"
   * button (`document.body.dataset.state='native'`), never initialized by the
   * trailing `<script>`. "Native" is really "no data-state matches anything",
   * so it is set explicitly here rather than asserted as already present.
   */
  async goto(): Promise<void> {
    await this.page.goto(`file://${MOCKUP_FILE_PATH}`);
    await this.page.evaluate(() => document.body.setAttribute('data-state', 'native'));
    await expect(this.page.locator('body')).toHaveAttribute('data-state', 'native');
  }

  /**
   * Clicks the nav button for `state` and waits for the body attribute to
   * flip.
   *
   * The mockup and the real app share ONE `page` (this spec alternates
   * `pages.analyticsMockup` and `pages.analytics` calls on the same tab), so
   * the previous step may have navigated away to the real app entirely —
   * reload the mockup file first whenever that's the case, or the click
   * below silently targets the wrong page's DOM and times out.
   */
  async gotoState(state: MockupState): Promise<void> {
    if (!this.page.url().startsWith('file://')) {
      await this.goto();
    }
    await this.page.locator(`[data-goto="${state}"]`).first().click();
    await expect(this.page.locator('body')).toHaveAttribute('data-state', state);
  }

  /**
   * The region a spec should screenshot/read for the given state — either
   * the visible dialog content (a `data-state` that opens a modal) or the
   * whole page body (a `data-state` that changes the base panel). Kept as
   * one lookup so the spec never has to know which shape a state is.
   */
  regionFor(state: MockupState): Locator {
    const dialogModifier = DIALOG_MODIFIER_BY_STATE[state];
    if (dialogModifier) {
      return this.page.locator(`.dialog__content--${dialogModifier}`);
    }
    return this.page.locator('body');
  }
}

/**
 * `data-state` -> the dialog's own BEM modifier class, read off the mockup's
 * CSS selectors (`body[data-state="X"] .dialog__content--Y { display: block; }`).
 * A state absent here renders inline on the base page rather than in a
 * dialog.
 */
const DIALOG_MODIFIER_BY_STATE: Partial<Record<MockupState, string>> = {
  'settings-open': 'settings',
  'detail-currency': 'detailcurrency',
  'detail-tax': 'detailtax',
  'tax-confirm': 'taxconfirm',
  'detail-novat': 'detailnovat',
  'detail-postrollout': 'detailpostrollout',
  'detail-mapping': 'detailmapping',
};
