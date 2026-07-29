/**
 * Offer/product picker modal page object (#1754 / #1779 / #1828)
 *
 * Covers `OfferProductPickerModal` — the SINGLE publish entry point for both
 * destination kinds. It is opened from two places and behaves identically:
 *   - `/listings` → "Publish products" (`listings-list-page.tsx:156`) with an
 *     empty selection;
 *   - `/products` → the bulk-action-bar CTA, which preseeds the table's
 *     checkbox selection as whole products via `initialProductIds`
 *     (`products-list-page.tsx:1246`).
 *
 * Layout (`offer-product-picker-modal.tsx:426`): a left list region (search +
 * paginated product rows, `offer-product-picker-row.tsx`) beside a right rail
 * (`offer-product-picker-rail.tsx`) holding the destination radiogroup and the
 * Cancel / "Continue →" actions. Continue navigates to
 * `/listings/bulk-create/wizard?productIds=…[&variantIds=…]&connectionId=…`
 * for BOTH marketplace and shop destinations (`offer-product-picker-modal.tsx:353`).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The wizard route both destination kinds land on (`offer-product-picker-modal.tsx:353`). */
export const BULK_WIZARD_URL = /\/listings\/bulk-create\/wizard/;

export class OfferProductPickerModal {
  constructor(private readonly page: Page) {}

  /**
   * The modal, scoped by its accessible name.
   *
   * Radix wires `DialogContent`'s `aria-labelledby` to its `DialogTitle`, so
   * the dialog's accessible name is the title text "Publish products"
   * (`offer-product-picker-modal.tsx:419`). Naming it matters: the picker's own
   * discard-guard `ConfirmDialog` (`:571`) is a sibling dialog, so an unnamed
   * `getByRole('dialog')` would go ambiguous the moment that guard opens.
   */
  get dialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Publish products' });
  }

  async expectVisible(): Promise<void> {
    await expect(this.dialog).toBeVisible({ timeout: 15_000 });
  }

  /** `offer-product-picker-modal.tsx:439` (`aria-label="Search products"`). */
  get searchField(): Locator {
    return this.dialog.getByLabel('Search products');
  }

  /** A product row in the left list (`offer-product-picker-row.tsx:94`). */
  productRow(productText: string): Locator {
    return this.dialog
      .locator('li.offer-product-picker__prow')
      .filter({ hasText: productText });
  }

  /**
   * Search for a product and tick its whole-product checkbox.
   *
   * The row checkbox's accessible name is `Select {product.name}`
   * (`offer-product-picker-row.tsx:105`), so the check is scoped to the named
   * product rather than "the first checkbox" of a possibly-unfiltered,
   * debounce-lagging list.
   */
  async selectWholeProduct(productName: string): Promise<void> {
    await this.searchField.fill(productName);
    const row = this.productRow(productName).first();
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    await row.getByRole('checkbox', { name: `Select ${productName}` }).check();
  }

  /**
   * Search for a product, expand it, and tick its first variant.
   *
   * Variants lazy-load on expand (`offer-product-picker-row.tsx:51`), so the
   * expand toggle (`aria-label="Expand {name}"`, `:117`) must fire before the
   * per-variant checkboxes in `.offer-product-picker__vrows` (`:140`) exist.
   */
  async selectFirstVariantOf(productName: string): Promise<void> {
    await this.searchField.fill(productName);
    const row = this.productRow(productName).first();
    await row.waitFor({ state: 'visible', timeout: 15_000 });

    const toggle = row.locator('button.offer-product-picker__prow-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    const variantCheckbox = row
      .locator('ul.offer-product-picker__vrows')
      .getByRole('checkbox')
      .first();
    await variantCheckbox.waitFor({ state: 'visible', timeout: 15_000 });
    await variantCheckbox.check();
  }

  /**
   * The destination radiogroup in the rail.
   *
   * `PublishDestinationRail` renders `role="radiogroup"` (`publish-destination-rail.tsx:94`);
   * inside the picker it is labelled by the "Publish to *" eyebrow
   * (`offer-product-picker-rail.tsx:219-227`), which is that group's accessible
   * name. It is a radiogroup of `role="radio"` buttons — NOT a `<select>`.
   */
  get destinationRail(): Locator {
    return this.dialog.getByRole('radiogroup', { name: /^Publish to/ });
  }

  /**
   * Pick a destination by connection name.
   *
   * With exactly one eligible destination the picker auto-resolves it
   * (`offer-product-picker-modal.tsx:182`) and clicking is unnecessary — but
   * the radio is still rendered, so selecting it is idempotent. Each radio's
   * accessible name is `{connection.name}{kind hint}`
   * (`publish-destination-rail.tsx:128-133`), hence the substring filter.
   */
  async chooseDestination(connectionName: string): Promise<void> {
    const option = this.destinationRail.getByRole('radio').filter({ hasText: connectionName });
    await expect(
      option,
      `destination "${connectionName}" should be offered in the publish rail`,
    ).toHaveCount(1, { timeout: 15_000 });
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
  }

  /** The rail's forward CTA ("Continue →", `offer-product-picker-rail.tsx:241`). */
  get continueButton(): Locator {
    return this.dialog.getByRole('button', { name: /^Continue/ });
  }

  /** Commit the selection and land on the bulk wizard route. */
  async continueToWizard(): Promise<void> {
    await expect(this.continueButton).toBeEnabled({ timeout: 15_000 });
    await this.continueButton.click();
    await this.page.waitForURL(BULK_WIZARD_URL, { timeout: 30_000 });
  }

  /** Cancel out. A pending selection routes through the discard guard (`:571`). */
  async cancel(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const discard = this.page.getByRole('dialog', { name: 'Discard changes?' });
    if (await discard.isVisible().catch(() => false)) {
      await discard.getByRole('button', { name: 'Discard changes' }).click();
    }
  }
}
