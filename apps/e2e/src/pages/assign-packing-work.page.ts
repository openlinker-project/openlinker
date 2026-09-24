/**
 * Fulfilment screen page object (#3340/#3343, ADR-074)
 *
 * `/fulfillment` — the one admin/operator fulfilment screen, since the
 * staffing board and the execution worklist merged. This object drives the
 * staffing half: lanes per packer, "Move to", self-serve, holds.
 *
 * ## Two locators here were already wrong before the merge
 *
 * They reached for `.fulfilment-worklist__desktop .fulfilment-worklist-row`,
 * describing a dual desktop-row / mobile-card render that #3401 replaced with
 * ONE reflowing card months earlier. Nothing caught it because the specs that
 * use them are opt-in. A card carries `data-task-id`, which is a hook meant
 * for exactly this and cannot drift with a class rename.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class AssignPackingWorkPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/fulfillment');
    await expect(this.page.getByRole('heading', { name: 'Fulfilment' })).toBeVisible();
  }

  laneFor(name: string): Locator {
    return this.page.locator('.assign-packing-work-lane').filter({
      has: this.page.locator('.assign-packing-work-lane__title', { hasText: name }),
    });
  }

  /** The card for `workId`, by the id it carries rather than by its text. */
  rowFor(workId: string): Locator {
    return this.page.locator(`.assign-packing-work-card[data-task-id="${workId}"]`);
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
    // "Put on hold", not "Hold": the screen renders the shared action set now,
    // so the label is `fulfillmentActionLabel`'s, the same one the order panel
    // and the dialog's own submit button use.
    await this.rowFor(workId).getByRole('button', { name: 'Put on hold' }).click();
    const dialog = this.page.getByRole('dialog', { name: 'Put this fulfilment task on hold' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Note (optional)').fill(note);
    await dialog.getByRole('button', { name: 'Put on hold' }).click();
    await expect(dialog).toBeHidden();
  }
}
