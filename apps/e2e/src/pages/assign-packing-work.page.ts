/**
 * Assign Packing Work page object (#3340/#3343, ADR-074)
 *
 * `/fulfillment/assign` — an admin/operator staffing board. Click-only, per
 * the screen's own scope decision (no drag-and-drop; "Move to" is the whole
 * reassignment surface). Both a desktop row (`FulfillmentWorklistRow`) and a
 * mobile card (`FulfillmentTaskCard`) render for every task at once — one
 * hidden by a media query — so every locator is scoped to
 * `.fulfilment-worklist__desktop` to avoid a Playwright strict-mode match on
 * the hidden duplicate.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class AssignPackingWorkPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/fulfillment/assign');
    await expect(this.page.getByRole('heading', { name: 'Assign packing work' })).toBeVisible();
  }

  laneFor(name: string): Locator {
    return this.page.locator('.assign-packing-work-lane').filter({
      has: this.page.locator('.assign-packing-work-lane__title', { hasText: name }),
    });
  }

  /** The desktop row for `workId`, scoped so the hidden mobile card never matches too. */
  rowFor(workId: string): Locator {
    return this.page
      .locator('.fulfilment-worklist__desktop .fulfilment-worklist-row')
      .filter({ has: this.page.locator(`[title="${workId}"]`) });
  }

  moveToSelect(workId: string): Locator {
    return this.rowFor(workId).getByLabel('Move to');
  }

  selfServeCheckbox(workId: string): Locator {
    return this.rowFor(workId).locator('.assign-packing-work-actions__self-serve input');
  }

  async moveTo(workId: string, packerUsername: string): Promise<void> {
    await this.moveToSelect(workId).selectOption({ label: packerUsername });
  }

  async toggleSelfServe(workId: string): Promise<void> {
    await this.selfServeCheckbox(workId).click();
  }

  async placeHold(workId: string, note: string): Promise<void> {
    await this.rowFor(workId).getByRole('button', { name: 'Hold' }).click();
    const dialog = this.page.getByRole('dialog', { name: 'Put this fulfilment task on hold' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Note (optional)').fill(note);
    await dialog.getByRole('button', { name: 'Put on hold' }).click();
    await expect(dialog).toBeHidden();
  }
}
