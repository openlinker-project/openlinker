/**
 * Product detail page object
 *
 * Covers `/products/:id` — the Overview tab with "External IDs", "Variants"
 * (count in the heading, e.g. "Variants (3)") and "Stock" sections. Stock is
 * master-sourced and read-only here.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class ProductDetailPage {
  constructor(private readonly page: Page) {}

  async goto(productId: string): Promise<void> {
    await this.page.goto(`/products/${productId}`);
    await expect(this.variantsTable).toBeVisible();
  }

  get variantsTable(): Locator {
    return this.page.getByRole('table', { name: 'Product variants' });
  }

  get stockTable(): Locator {
    return this.page.getByRole('table', { name: 'Stock levels' });
  }

  get variantsHeading(): Locator {
    return this.page.getByRole('heading', { name: /^Variants/ });
  }

  /** Data rows in the variants table (excludes the header row). */
  variantRows(): Locator {
    return this.variantsTable.getByRole('row').filter({ has: this.page.getByRole('cell') });
  }
}
