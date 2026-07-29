/**
 * Products list page object
 *
 * Covers `/products` — the product DataTable, row multi-select, and the
 * `BulkActionBar` publish action. The action label depends on topology
 * (`products-list-page.tsx:1116-1118`): with exactly one publish destination it
 * reads `Publish to {platformDisplayName} (N)` and navigates STRAIGHT to the
 * bulk wizard (`:509-511`); with 2+ it reads `Publish products (N)` and opens
 * `OfferProductPickerModal` with the table's selection preseeded as whole
 * products (`:512-514` / `:1246`), so the operator only picks a destination
 * there. With 0 destinations the action is not rendered at all (`:1114`).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { BulkOfferWizard } from './bulk-offer-wizard.page';
import { BULK_WIZARD_URL, OfferProductPickerModal } from './offer-product-picker.page';

export class ProductsListPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/products');
    await expect(this.page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  }

  /**
   * The page's own search box (`products-list-page.tsx:855`). Named in full so
   * it can never collide with the publish picker's `aria-label="Search products"`
   * (`offer-product-picker-modal.tsx:439`) once that modal is open.
   */
  get searchField(): Locator {
    return this.page.getByLabel('Search products by name or SKU', { exact: true });
  }

  /** The row-select checkbox for a product identified by visible text (name/SKU). */
  selectRowCheckbox(productText: string): Locator {
    return this.page
      .getByRole('row')
      .filter({ hasText: productText })
      .getByRole('checkbox');
  }

  async selectProduct(productText: string): Promise<void> {
    await this.selectRowCheckbox(productText).check();
  }

  /**
   * The bulk action-bar publish button (`products-list-page.tsx:1115-1119`).
   *
   * Matches both topology labels — `Publish to {name} (N)` (one destination)
   * and `Publish products (N)` (2+). The count is `toLocaleString()`-formatted,
   * hence the separator-tolerant digit class.
   */
  get publishButton(): Locator {
    return this.page.getByRole('button', {
      name: /^Publish (?:products|to .+) \([\d\s,.\u00a0\u202f]+\)$/,
    });
  }

  /**
   * Click the publish action and land on the bulk wizard.
   *
   * With one publish destination the click navigates directly; with 2+ it opens
   * `OfferProductPickerModal` with the table selection already ticked, in which
   * case `connectionName` picks the destination in the modal's rail before
   * continuing.
   */
  async startBulkOfferCreation(connectionName?: string): Promise<BulkOfferWizard> {
    await this.publishButton.click();

    const picker = new OfferProductPickerModal(this.page);

    // Wait for whichever the topology produces: direct navigation or the picker.
    await expect(async () => {
      if (BULK_WIZARD_URL.test(this.page.url())) return;
      if (await picker.dialog.isVisible()) return;
      throw new Error('neither wizard navigation nor the publish picker appeared yet');
    }).toPass({ timeout: 15_000 });

    if (!BULK_WIZARD_URL.test(this.page.url())) {
      if (!connectionName) {
        throw new Error(
          'Publish picker opened (2+ publish destinations) but no connectionName was given',
        );
      }
      await picker.chooseDestination(connectionName);
      await picker.continueToWizard();
    }

    const wizard = new BulkOfferWizard(this.page);
    await wizard.expectOnConfigStep();
    return wizard;
  }
}
