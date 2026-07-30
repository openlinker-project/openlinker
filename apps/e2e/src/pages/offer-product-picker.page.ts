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

  /**
   * A product row (`offer-product-picker-row.tsx:94`) whose OWN name or SKU
   * EXACTLY equals `productText`.
   *
   * Matched via a descendant exact-text locator — the name's `<b>` (`:121`) or
   * the SKU's `<small>` (`:122`) — NOT `hasText`'s substring match against the
   * row's whole flattened text, mirroring `products.page.ts:36-53`. That comment
   * documents why, and it applies verbatim here: this stack routinely carries
   * same-named products from different masters, so a substring match on
   * "Adidas Runner" also matches a "Adidas Runner Kids" row (and a SKU
   * `OL-ADIDAS-IA4845` is a substring of `OL-ADIDAS-IA4845-S`). Resolving the
   * wrong row here publishes the wrong product's variant, and the failure only
   * surfaces a minute later as a poll timing out on a variant nothing submitted.
   */
  productRow(productText: string): Locator {
    return this.dialog
      .locator('li.offer-product-picker__prow')
      .filter({ has: this.page.getByText(productText, { exact: true }) });
  }

  /**
   * Search for a product and resolve its row, requiring the match to be UNIQUE.
   *
   * Exact text removes the substring hazard but not duplicate names across
   * masters, so ambiguity is reported here rather than silently resolved by a
   * `.first()`. The caller's fix is to pass the SKU, which the picker's search
   * accepts alongside name and EAN (`offer-product-picker-modal.tsx:438`).
   */
  private async resolveProductRow(productText: string): Promise<Locator> {
    await this.searchField.fill(productText);
    const rows = this.productRow(productText);
    await expect(
      rows,
      `exactly one picker row should carry "${productText}" as its exact product name or SKU ` +
        '(0 = the search returned no such row; 2+ = several products share it, so pass the ' +
        'SKU instead of the name)',
    ).toHaveCount(1, { timeout: 15_000 });
    return rows;
  }

  /**
   * Search for a product and tick its whole-product checkbox.
   *
   * The checkbox is scoped structurally, to the main row's own
   * `label.offer-product-picker__prow-check` (`offer-product-picker-row.tsx:99-111`),
   * rather than by its `Select {product.name}` accessible name — `productText`
   * may legitimately be a SKU, and the variant sub-rows carry their own
   * checkboxes.
   */
  async selectWholeProduct(productText: string): Promise<void> {
    const row = await this.resolveProductRow(productText);
    await row.locator('label.offer-product-picker__prow-check').getByRole('checkbox').check();
  }

  /**
   * Search for a product, expand it, and tick its first variant.
   *
   * Variants lazy-load on expand (`offer-product-picker-row.tsx:51`), so the
   * expand toggle (`:112-118`) must fire before the per-variant checkboxes in
   * `.offer-product-picker__vrows` (`:140`) exist.
   */
  async selectFirstVariantOf(productText: string): Promise<void> {
    const row = await this.resolveProductRow(productText);

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
