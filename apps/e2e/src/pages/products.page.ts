/**
 * Products list page object
 *
 * Covers `/products` — the product DataTable, row multi-select, and the
 * `BulkActionBar` create-offers action. The action label depends on topology
 * (`products-list-page.tsx`): with exactly one OfferManager connection it reads
 * `Create {platformName} offers (N)` and navigates straight to the wizard; with
 * 2+ connections it reads `Create offers (N)` and opens `MarketplacePickerModal`
 * instead of navigating, so the entry flow handles both.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { BulkOfferWizard } from './bulk-offer-wizard.page';

const WIZARD_URL = /\/listings\/bulk-create\/wizard/;

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

  /**
   * The bulk action-bar button. Label is `Create offers (N)` with 2+
   * OfferManager connections, `Create {platformName} offers (N)` with exactly
   * one — match both.
   */
  get createOffersButton(): Locator {
    return this.page.getByRole('button', { name: /^Create (?:.+ )?offers \([\d,  ]+\)$/ });
  }

  /** The marketplace-picker modal shown with 2+ OfferManager connections. */
  get marketplacePicker(): Locator {
    return this.page.getByRole('radiogroup', { name: 'Marketplace connection' });
  }

  /**
   * Click the create-offers action and land on the bulk wizard.
   *
   * With one OfferManager connection the click navigates directly; with 2+ it
   * opens the marketplace picker, in which case `connectionName` selects the
   * target connection before continuing.
   */
  async startBulkOfferCreation(connectionName?: string): Promise<BulkOfferWizard> {
    await this.createOffersButton.click();

    // Wait for whichever the topology produces: direct navigation or the picker.
    await expect(async () => {
      if (WIZARD_URL.test(this.page.url())) return;
      if (await this.marketplacePicker.isVisible()) return;
      throw new Error('neither wizard navigation nor the marketplace picker appeared yet');
    }).toPass({ timeout: 15_000 });

    if (!WIZARD_URL.test(this.page.url())) {
      if (!connectionName) {
        throw new Error(
          'Marketplace picker opened (2+ OfferManager connections) but no connectionName was given',
        );
      }
      await this.marketplacePicker
        .getByRole('radio')
        .filter({ hasText: connectionName })
        .click();
      await this.page
        .getByRole('dialog')
        .getByRole('button', { name: /^Continue/ })
        .click();
      await this.page.waitForURL(WIZARD_URL);
    }

    const wizard = new BulkOfferWizard(this.page);
    await wizard.expectOnConfigStep();
    return wizard;
  }
}
