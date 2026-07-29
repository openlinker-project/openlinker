/**
 * Product detail page object
 *
 * Covers `/products/:id` — the Overview tab. The separate "Variants" and
 * "Stock" tables were merged (#1752) into one `VariantStockTable` whose sr-only
 * caption — and therefore accessible name — is "Product variants, stock levels,
 * and marketplace listings" (`variant-stock-table.tsx:75`).
 *
 * Two shapes render under the same section heading
 * (`product-detail-page.tsx:278-282`):
 *   - multi-variant → the table (`:314`), heading `Variants & stock (N)`;
 *   - single-variant → `VariantDetailPanel` and NO table, heading `Listed on`.
 * Below 640px the table folds into `.variant-cards` (`variant-stock-table.tsx:53`),
 * which also has no `role="table"` — irrelevant at the suite's Desktop Chrome
 * viewport, but the reason `goto` waits on the heading rather than the table.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class ProductDetailPage {
  constructor(private readonly page: Page) {}

  async goto(productId: string): Promise<void> {
    await this.page.goto(`/products/${productId}`);
    await expect(this.variantsHeading).toBeVisible();
  }

  /**
   * The merged variants + stock + listings table (`variant-stock-table.tsx:75`).
   * Present only for a MULTI-variant product — see the module note.
   */
  get variantsTable(): Locator {
    return this.page.getByRole('table', {
      name: 'Product variants, stock levels, and marketplace listings',
    });
  }

  /**
   * The section heading (`product-detail-page.tsx:278-282`) — `Listed on` for a
   * single-variant product, `Variants & stock (N)` otherwise.
   */
  get variantsHeading(): Locator {
    return this.page.getByRole('heading', { name: /^(Variants & stock|Listed on)/ });
  }

  /**
   * Data rows in the variants table.
   *
   * Each variant renders TWO `<tr>`s — the visible row and its always-mounted
   * expand row (`variant-stock-table.tsx:591` / `:634`) — so the count is
   * filtered to rows carrying the per-variant expand toggle
   * (`aria-label="Toggle listings for {sku}"`, `:597`), which only the visible
   * row has. Filtering on `role="cell"` alone would double-count.
   */
  variantRows(): Locator {
    return this.variantsTable
      .getByRole('row')
      .filter({ has: this.page.locator('button[aria-label^="Toggle listings for"]') });
  }
}
