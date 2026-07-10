/**
 * Listings list page object
 *
 * Covers `/listings` — the offer-mapping table plus the two launchers that live
 * here: "Publish to shop" (shown when an active connection has the
 * `ProductPublisher` capability) and "Create offer" (single-offer launcher).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { PublishToShopDialog } from './publish-dialog.page';

export class ListingsListPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/listings');
    await expect(this.page.getByRole('heading', { name: 'Listings', exact: true })).toBeVisible();
  }

  get publishToShopButton(): Locator {
    return this.page.getByRole('button', { name: 'Publish to shop' });
  }

  get createOfferButton(): Locator {
    return this.page.getByRole('button', { name: 'Create offer' });
  }

  /** Open the "Publish to shop" dialog and return its page object. */
  async openPublishToShop(): Promise<PublishToShopDialog> {
    await this.publishToShopButton.click();
    const dialog = new PublishToShopDialog(this.page);
    await dialog.expectVisible();
    return dialog;
  }
}
