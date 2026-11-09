/**
 * OMS onboarding wizard mockup page object (#3458)
 *
 * Drives the repo-committed mockup `docs/plans/mockups/oms-onboarding-wizard.html`
 * straight off disk via `file://` - never the Claude Artifact URL
 * (`docs/frontend-architecture.md` § UX Mockups). The mockup's harness picks
 * a state with `[data-testid="mockup-state-chip"][data-preset=...]` and a
 * product-master setup with `[data-testid="mockup-source-chip"][data-source=...]`;
 * the resulting state is written to `body[data-state]` / `body[data-source]`.
 *
 * ## The mockup has 4 steps, the shipped wizard has 7
 *
 * The mockup was drawn for #3457 as a four-step flow. The wizard that shipped
 * added sales documents (step 2), automations (5) and who decides (6), so the
 * step numbers in the live `data-state` names moved. `LIVE_STATE_FOR_MOCKUP`
 * is the one place that maps a mockup name onto the live one; the three
 * live-only steps have no mockup baseline and are listed in
 * `LIVE_ONLY_STATES` so the live spec still visits them.
 *
 * @module pages
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

export const OMS_ONBOARDING_MOCKUP_FILE = resolve(
  HERE,
  '../../../../docs/plans/mockups/oms-onboarding-wizard.html',
);

export const MockupPresetValues = [
  's1',
  's1-sync',
  's1-complete',
  's2',
  's2-added',
  's3',
  's4',
  'waiting',
  'first',
  'live',
  'off',
] as const;
export type MockupPreset = (typeof MockupPresetValues)[number];

export const MockupSourceValues = ['prestashop', 'woocommerce', 'subiekt', 'none', 'two'] as const;
export type MockupSource = (typeof MockupSourceValues)[number];

/** The `body[data-state]` each preset renders with a single, named product master. */
export const MOCKUP_STATE_FOR_PRESET: Record<MockupPreset, string> = {
  s1: 'step-1-product-master',
  's1-sync': 'step-1-stock-syncing',
  's1-complete': 'step-1-stock-complete',
  s2: 'step-2-packers-empty',
  's2-added': 'step-2-packer-added',
  s3: 'step-3-what-changes',
  s4: 'step-4-turn-on',
  waiting: 'waiting-first-order',
  first: 'first-order-arrived',
  live: 'status-on',
  off: 'status-off',
};

/** Mockup `data-state` -> the live wizard's `data-state` for the same screen. */
export const LIVE_STATE_FOR_MOCKUP: Record<string, string> = {
  'step-1-product-master': 'step-1-product-master',
  'step-1-no-product-master': 'step-1-no-product-master',
  'step-1-two-product-masters': 'step-1-two-product-masters',
  'step-1-stock-syncing': 'step-1-stock-syncing',
  'step-1-stock-complete': 'step-1-stock-complete',
  'step-2-packers-empty': 'step-3-packers-empty',
  'step-2-packer-added': 'step-3-packer-added',
  'step-3-what-changes': 'step-4-what-changes',
  'step-4-turn-on': 'step-7-turn-on',
  'waiting-first-order': 'waiting-first-order',
  'first-order-arrived': 'first-order-arrived',
  'status-on': 'status-on',
  'status-off': 'status-off',
  'dialog-stop-confirm': 'dialog-stop-confirm',
};

/** Live wizard states the 4-step mockup does not draw. */
export const LIVE_ONLY_STATES = [
  'step-2-sales-documents',
  'step-5-automations',
  'step-6-who-decides',
] as const;

/**
 * Mockup `data-testid`s the 7-step wizard does not carry, each for a stated
 * reason. Anything else the mockup shows in a state must be present live.
 */
export const MOCKUP_ONLY_TEST_IDS: ReadonlyMap<string, string> = new Map([
  // The turn-on summary links back by step key (`btn-step-*`, `link-setup-*`)
  // because the wizard's step numbers no longer match the mockup's.
  ['setup-summary', 'replaced by the per-step setup checklist'],
  ['btn-go-step-1', 'replaced by btn-step-* on the setup checklist'],
  ['btn-go-step-1-stock', 'replaced by btn-step-* on the setup checklist'],
  ['btn-go-step-2', 'replaced by btn-step-* on the setup checklist'],
]);

/** Harness-only ids, and the stepper's numbered parts (7 live steps vs 4). */
export function isHarnessOrNumberedTestId(testId: string): boolean {
  return (
    testId.startsWith('mockup-') ||
    /^wizard-stepper-(step|button)-\d+$/.test(testId) ||
    testId.includes('${')
  );
}

export class OmsOnboardingMockupPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    if (this.page.url().split('#')[0] !== `file://${OMS_ONBOARDING_MOCKUP_FILE}`) {
      await this.page.goto(`file://${OMS_ONBOARDING_MOCKUP_FILE}`, { waitUntil: 'load' });
    }
  }

  /** Pick a product-master setup, then a state, and wait for `body[data-state]`. */
  async show(source: MockupSource, preset: MockupPreset, expectedState: string): Promise<void> {
    await this.open();
    await this.page.locator(`[data-testid="mockup-source-chip"][data-source="${source}"]`).click();
    await this.page.locator(`[data-testid="mockup-state-chip"][data-preset="${preset}"]`).click();
    await expect(this.page.locator('body')).toHaveAttribute('data-state', expectedState);
    await expect(this.page.locator('body')).toHaveAttribute('data-source', source);
  }

  /** The stop dialog carries its own `data-state`. */
  async openStopDialog(): Promise<void> {
    await this.page.getByTestId('btn-ask-stop').click();
    await expect(this.page.locator('[data-state="dialog-stop-confirm"]')).toBeVisible();
  }

  /** The visible, non-harness `data-testid`s on screen right now. */
  async visibleTestIds(scope?: Locator): Promise<string[]> {
    const root = scope ?? this.page.locator('#root');
    const ids = await root.locator('[data-testid]').evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = (element as HTMLElement).getBoundingClientRect();
          return box.width > 0 || box.height > 0;
        })
        .map((element) => element.getAttribute('data-testid') ?? ''),
    );
    return [...new Set(ids)].filter((id) => id !== '' && !isHarnessOrNumberedTestId(id)).sort();
  }
}
