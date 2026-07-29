/**
 * Listings list page object
 *
 * Covers `/listings` — the offer-mapping table plus the single publish
 * launcher that lives here. Since #1754 (unified offer creation) there is
 * exactly ONE CTA, "Publish products" (`listings-list-page.tsx:156`); the old
 * per-platform "Create offer" launcher and the separate "Publish to shop"
 * launcher are both gone. The CTA opens `OfferProductPickerModal`, which
 * routes BOTH marketplace and shop destinations into the bulk wizard.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { OfferProductPickerModal } from './offer-product-picker.page';

export class ListingsListPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/listings');
    await expect(this.page.getByRole('heading', { name: 'Listings', exact: true })).toBeVisible();
  }

  /**
   * The only publish entry point on this page (`listings-list-page.tsx:156`).
   * Rendered only for a writer (`useWriteAccess('listings:write')`, `:145`).
   */
  get publishProductsButton(): Locator {
    return this.page.getByRole('button', { name: 'Publish products', exact: true });
  }

  /** Open the unified product picker and return its page object. */
  async openPublishProducts(): Promise<OfferProductPickerModal> {
    await this.publishProductsButton.click();
    const picker = new OfferProductPickerModal(this.page);
    await picker.expectVisible();
    return picker;
  }
}
