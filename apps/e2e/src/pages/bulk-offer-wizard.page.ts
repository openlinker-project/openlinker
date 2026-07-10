/**
 * Bulk offer wizard page object (Allegro / Erli)
 *
 * Covers `/listings/bulk-create/wizard` → the SetupStepper flow
 * (Config → Resolving → Review → Confirm) rendered by `bulk/bulk-wizard.tsx`,
 * the confirm modal, and the transition to the batch progress page
 * (`/listings/bulk-batches/:batchId`).
 *
 * Marketplace connection selection is only shown when more than one eligible
 * connection exists; with a single connection the wizard shows "Publishing as
 * {name}" and no select.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { selectOptionByText } from '../support/selectors';
import { BulkBatchProgressPage } from './bulk-batch-progress.page';

export class BulkOfferWizard {
  constructor(private readonly page: Page) {}

  async expectOnConfigStep(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: 'Bulk marketplace offer creation' }),
    ).toBeVisible();
  }

  get marketplaceConnectionSelect(): Locator {
    return this.page.getByLabel('Marketplace connection');
  }

  /** Select the marketplace connection if the picker is present (multi-connection). */
  async selectConnectionIfPresent(connectionName: string): Promise<void> {
    if (await this.marketplaceConnectionSelect.count()) {
      await selectOptionByText(this.marketplaceConnectionSelect, connectionName);
    }
  }

  /** Advance Config → Resolving → Review by clicking the stepper's forward action. */
  get nextButton(): Locator {
    return this.page.getByRole('button', { name: /^(Next|Continue|Review)/ });
  }

  get confirmModalConfirmButton(): Locator {
    return this.page.getByRole('dialog').getByRole('button', { name: 'Create offers' });
  }

  get publishImmediatelyCheckbox(): Locator {
    return this.page.getByRole('dialog').getByRole('checkbox', { name: 'Publish immediately' });
  }

  /** Confirm creation in the final modal and land on the batch progress page. */
  async confirmCreation(): Promise<BulkBatchProgressPage> {
    await this.confirmModalConfirmButton.click();
    await this.page.waitForURL(/\/listings\/bulk-batches\/[^/]+$/);
    return new BulkBatchProgressPage(this.page);
  }
}
