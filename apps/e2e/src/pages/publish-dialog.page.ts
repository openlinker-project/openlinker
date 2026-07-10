/**
 * Publish-to-shop dialog page object (WooCommerce, redesign #1414)
 *
 * Covers `ShopPublishLauncher.tsx` (connection picker) → the
 * `WoocommercePublishWizard.tsx` body (selection → configure → review →
 * publish → tracker). Titles mirror the components: "Publish to shop" for the
 * picker, `Publish to {name}` once a connection is chosen.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { selectOptionByText } from '../support/selectors';

export class PublishToShopDialog {
  constructor(private readonly page: Page) {}

  get dialog(): Locator {
    return this.page.getByRole('dialog');
  }

  async expectVisible(): Promise<void> {
    await expect(
      this.dialog.getByRole('heading', { name: /^Publish to/ }),
    ).toBeVisible();
  }

  get connectionSelect(): Locator {
    return this.dialog.getByLabel('Shop connection');
  }

  get continueButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Continue' });
  }

  get cancelButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Cancel' });
  }

  /**
   * Pick a shop connection by name. The launcher auto-skips the picker when
   * exactly one eligible connection exists (`ShopPublishLauncher.tsx`), so when
   * the select is absent this is a no-op and the wizard is already showing.
   */
  async chooseConnection(connectionName: string): Promise<void> {
    if ((await this.connectionSelect.count()) === 0) {
      return;
    }
    await selectOptionByText(this.connectionSelect, connectionName);
    await this.continueButton.click();
  }

  get productSearchField(): Locator {
    return this.dialog.getByLabel('Search products');
  }

  /** A product row (expand button) in the selection list, by visible text. */
  productRow(productText: string): Locator {
    return this.dialog
      .locator('.create-offer-variant-picker__product-row')
      .filter({ hasText: productText });
  }

  /**
   * Search for a product, expand its row, and check its first variant.
   *
   * The selection step's checkboxes are per-variant and only render after the
   * product row is expanded (`WoocommercePublishWizard.tsx`). Scoping every
   * step to the named product row also sidesteps the debounced-search race —
   * we never touch "the first checkbox" of a possibly-unfiltered list.
   */
  async selectFirstVariantOf(productText: string): Promise<void> {
    await this.productSearchField.fill(productText);
    const row = this.productRow(productText).first();
    await row.waitFor({ state: 'visible' });
    if ((await row.getAttribute('aria-expanded')) !== 'true') {
      await row.click();
    }
    const variantCheckbox = this.dialog
      .locator('.create-offer-variant-picker__variants')
      .getByRole('checkbox')
      .first();
    await variantCheckbox.waitFor({ state: 'visible' });
    await variantCheckbox.check();
  }

  /** The wizard's forward action on the selection step ("Continue with N product(s)"). */
  get continueWithSelectionButton(): Locator {
    return this.dialog.getByRole('button', { name: /^Continue with \d+ product/ });
  }

  get reviewButton(): Locator {
    return this.dialog.getByRole('button', { name: 'Review' });
  }

  get confirmPublishButton(): Locator {
    return this.dialog.getByRole('button', { name: /^(Confirm & publish|Publish)/ });
  }

  async close(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Close' }).click();
  }
}
