/**
 * Product-page variant table + cost editor (#3591)
 *
 * `/products/:id` -> "Variants & stock". A multi-variant product lists rows
 * whose drawer (opened with the row's toggle) holds the Cost price section; a
 * single-variant product renders that same panel always open. The row's
 * "Cost (net)" cell (`variant-cost-cell-{slug}`) is visible either way. The
 * slug is the SKU lower-cased, the same rule the app uses.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export function slugOf(sku: string): string {
  return sku.toLowerCase();
}

export class VariantCostPage {
  constructor(private readonly page: Page) {}

  async goto(productId: string): Promise<void> {
    await this.page.goto(`/products/${encodeURIComponent(productId)}`);
    await expect(this.page.getByTestId('variant-table-section')).toBeVisible();
  }

  row(sku: string): Locator {
    return this.page.getByTestId(`variant-row-${slugOf(sku)}`).first();
  }

  costCell(sku: string): Locator {
    return this.page.getByTestId(`variant-cost-cell-${slugOf(sku)}`).first();
  }

  photoStrip(sku: string): Locator {
    return this.page.getByTestId(`variant-photo-strip-${slugOf(sku)}`).first();
  }

  get photoSource(): Locator {
    return this.page.getByTestId('variant-photo-source');
  }

  /** Open the variant's drawer when it is not already open (single-variant products are always open). */
  async open(sku: string): Promise<void> {
    const add = this.page.getByTestId(`variant-cost-add-${slugOf(sku)}`);
    const edit = this.page.getByTestId(`variant-cost-edit-${slugOf(sku)}`);
    if ((await add.count()) + (await edit.count()) > 0 && (await add.or(edit).first().isVisible())) return;
    const toggle = this.page.getByRole('button', { name: new RegExp(`Toggle listings for ${sku}`, 'i') });
    if (await toggle.count()) await toggle.first().click();
    await expect(add.or(edit).first()).toBeVisible();
  }

  addButton(sku: string): Locator {
    return this.page.getByTestId(`variant-cost-add-${slugOf(sku)}`);
  }

  editButton(sku: string): Locator {
    return this.page.getByTestId(`variant-cost-edit-${slugOf(sku)}`);
  }

  clearButton(sku: string): Locator {
    return this.page.getByTestId(`variant-cost-clear-${slugOf(sku)}`);
  }

  form(sku: string): Locator {
    return this.page.getByTestId(`variant-cost-form-${slugOf(sku)}`);
  }

  value(sku: string): Locator {
    return this.page.getByTestId(`variant-cost-value-${slugOf(sku)}`);
  }

  provenance(sku: string): Locator {
    return this.page.getByTestId(`variant-cost-provenance-${slugOf(sku)}`);
  }

  get input(): Locator {
    return this.page.getByTestId('variant-cost-input');
  }

  get currency(): Locator {
    return this.page.getByTestId('variant-cost-currency');
  }

  get error(): Locator {
    return this.page.getByTestId('variant-cost-error');
  }

  get readonlyReason(): Locator {
    return this.page.getByTestId('variant-cost-readonly-reason');
  }

  /** Fill and submit the open form. `currency` is left alone when omitted (it defaults to the product's). */
  async submit(amount: string, currency?: string): Promise<void> {
    await this.input.fill(amount);
    if (currency) await this.currency.selectOption(currency);
    await this.page.getByTestId('variant-cost-save').click();
  }

  async addCost(sku: string, amount: string, currency?: string): Promise<void> {
    await this.open(sku);
    await this.addButton(sku).click();
    await this.submit(amount, currency);
    await expect(this.value(sku)).toBeVisible();
  }
}
