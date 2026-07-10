/**
 * Products list page object
 *
 * Covers `/products` — the product DataTable, row multi-select, and the
 * `BulkActionBar` "Create offers (N)" action that navigates to the bulk offer
 * wizard.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { BulkOfferWizard } from './bulk-offer-wizard.page';

export class ProductsListPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/products');
    await expect(this.page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  }

  get searchField(): Locator {
    return this.page.getByLabel('Search products');
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

  /** The bulk action-bar button, whose label carries the selection count. */
  get createOffersButton(): Locator {
    return this.page.getByRole('button', { name: /^Create offers \(\d+\)$/ });
  }

  /** Click "Create offers (N)" and land on the bulk wizard. */
  async startBulkOfferCreation(): Promise<BulkOfferWizard> {
    await this.createOffersButton.click();
    await this.page.waitForURL(/\/listings\/bulk-create\/wizard/);
    const wizard = new BulkOfferWizard(this.page);
    await wizard.expectOnConfigStep();
    return wizard;
  }
}
