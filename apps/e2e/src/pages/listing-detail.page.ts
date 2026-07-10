/**
 * Listing (offer-mapping) detail page object
 *
 * Covers `/listings/:id` — title `Mapping — {externalId}`, the KeyValueList of
 * mapping fields, and the optional "Offer creation" section.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class ListingDetailPage {
  constructor(private readonly page: Page) {}

  async goto(mappingId: string): Promise<void> {
    await this.page.goto(`/listings/${mappingId}`);
    await expect(this.heading).toBeVisible();
  }

  get heading(): Locator {
    return this.page.getByRole('heading', { name: /^Mapping —/ });
  }

  get offerCreationHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Offer creation' });
  }
}
