/**
 * Assign Packing Work mockup page object (#3338/#3343/#3362)
 *
 * Opens the REPO-COMMITTED mockup file directly off disk
 * (`docs/plans/mockups/assign-packing-work.html`) via `file://` — never the
 * Artifact URL.
 *
 * Unlike the pack-bench mockup, this one is NOT a set of mutually-exclusive
 * full-screen panels swapped via `[data-state]` — a hold form, a drag-over
 * highlight and a pickable toggle are transient overlays on top of the SAME
 * persistent board (#3362's own switcher comment states this). #3362 added
 * a `[data-demo-state-btn]` switcher that drives each overlay through the
 * real interaction that produces it (a real click/toggle/simulated drag),
 * never a parallel rendering — so, corrected from this file's earlier
 * revision, the switcher DOES exist and #3385's review asked whether it now
 * makes those states independently drivable. It does, for `hold-form-open`
 * and `assignment-only` — `setDemoState` below drives them, and the spec
 * takes a paired structural screenshot beside each real-app assertion. Two
 * remain intentionally not re-driven here: `drag-over` has no real-screen
 * counterpart at all (drag-and-drop is explicitly OUT of the real screen's
 * scope — its own component docblock: "no drag-and-drop, per the screen's
 * own scope decision"), so pairing it with nothing would be a mockup-only
 * screenshot asserting no real behaviour; and `pickable` is the board's own
 * resting state, already covered by the baseline screenshot. Content-level
 * correctness for every state stays where it belongs — asserted against the
 * REAL app's own before/after DOM in the spec, never inferred from a mockup
 * screenshot, which is a structural reference only.
 *
 * @module pages
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));

export const ASSIGN_PACKING_WORK_MOCKUP_FILE_PATH = resolve(
  HERE,
  '../../../../docs/plans/mockups/assign-packing-work.html',
);

/** The two demo-switcher states with a real-screen counterpart worth pairing. */
export const ASSIGN_PACKING_WORK_MOCKUP_DEMO_STATES = ['hold-form-open', 'assignment-only'] as const;

export type AssignPackingWorkMockupDemoState =
  (typeof ASSIGN_PACKING_WORK_MOCKUP_DEMO_STATES)[number];

export class AssignPackingWorkMockupPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`file://${ASSIGN_PACKING_WORK_MOCKUP_FILE_PATH}`);
    await expect(this.page.locator('#lanes')).toBeVisible();
  }

  get board(): Locator {
    return this.page.locator('#lanes');
  }

  /**
   * Clicks the `[data-demo-state-btn="…"]` switcher entry, then waits for
   * the real DOM change it produces — the switcher sets no `[data-state]`
   * attribute (unlike pack-bench's), so each state is confirmed by the
   * artefact it actually creates rather than a shared marker.
   */
  async setDemoState(state: AssignPackingWorkMockupDemoState): Promise<void> {
    await this.page.locator(`[data-demo-state-btn="${state}"]`).click();
    if (state === 'hold-form-open') {
      await expect(this.page.locator('.hold-form')).toBeVisible();
      return;
    }
    // 'assignment-only' unchecks the first unassigned card's pickable box.
    await expect(this.page.locator('[data-pickable]').first()).not.toBeChecked();
  }
}
