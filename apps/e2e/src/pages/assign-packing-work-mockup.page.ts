/**
 * Assign Packing Work mockup page object (#3338/#3343)
 *
 * Opens the REPO-COMMITTED mockup file directly off disk
 * (`docs/plans/mockups/assign-packing-work.html`) via `file://` — never the
 * Artifact URL.
 *
 * Unlike the pack-bench mockup, this one carries no `data-state-btn` nav
 * strip: it demonstrates `pickable` / `assignment-only` / `drag-over` /
 * `hold-form-open` as LIVE interaction artefacts (a checkbox toggle, a
 * simulated drag, a form opened in place) rather than named, independently
 * reachable panels. The real screen implements the click-only subset of
 * these (`assign-packing-work.page.ts`'s `moveTo` / `toggleSelfServe` /
 * `placeHold`) — drag-and-drop is explicitly OUT of the real screen's scope
 * (its own component docblock: "no drag-and-drop, per the screen's own scope
 * decision"). This page object therefore exposes only the board's baseline
 * loaded state for a structural screenshot comparison; the real screen's
 * per-action states are verified against the REAL app's own before/after
 * content in the spec, not re-driven here.
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

export class AssignPackingWorkMockupPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(`file://${ASSIGN_PACKING_WORK_MOCKUP_FILE_PATH}`);
    await expect(this.page.locator('#lanes')).toBeVisible();
  }

  get board(): Locator {
    return this.page.locator('#lanes');
  }
}
