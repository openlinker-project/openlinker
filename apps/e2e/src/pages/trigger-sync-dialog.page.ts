/**
 * Trigger-sync dialog page object (#1474)
 *
 * The dialog launched from a connection's actions panel to manually enqueue a
 * sync job. Options are gated by the connection's capabilities; labels mirror
 * `TriggerSyncDialog.tsx`.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** Visible option labels mapped from their underlying job-type value. */
export const TriggerSyncJobLabels = {
  'master.product.syncAll': 'Sync all products',
  'master.product.syncByExternalId': 'Sync product by ID',
  'master.inventory.syncAll': 'Sync all inventory',
  'master.inventory.syncByExternalId': 'Sync inventory by ID',
  'master.variants.autoMatch': 'Auto-match variants',
  'marketplace.offers.sync': 'Sync marketplace offers',
  'marketplace.orders.poll': 'Poll marketplace orders',
  'inventory.propagateToMarketplaces': 'Propagate inventory to marketplaces',
} as const;

export class TriggerSyncDialog {
  constructor(private readonly page: Page) {}

  get dialog(): Locator {
    return this.page.getByRole('dialog');
  }

  async expectVisible(): Promise<void> {
    await expect(this.dialog.getByRole('heading', { name: 'Trigger sync' })).toBeVisible();
  }

  get jobTypeSelect(): Locator {
    return this.dialog.getByLabel('Job type');
  }

  get confirmButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Trigger' });
  }

  get cancelButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Cancel' });
  }

  async selectJob(label: string): Promise<void> {
    await this.jobTypeSelect.selectOption({ label });
  }

  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }
}
