/**
 * Product stock page object (G08)
 *
 * The variants table on `/products/:id` with its Stock column, the expanded
 * row, and the manual-correction dialog. Locators are the `stock-*` test ids
 * the page publishes; `key` is the variant's `sku ?? id`.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class ProductStockPage {
  constructor(private readonly page: Page) {}

  async goto(productId: string): Promise<void> {
    await this.page.goto(`/products/${productId}`);
    await expect(this.page.getByTestId('stock-summary-atp')).toBeVisible();
  }

  row(key: string): Locator {
    return this.page.getByTestId(`stock-variant-row-${key}`);
  }

  atp(key: string): Locator {
    return this.page.getByTestId(`stock-atp-${key}`);
  }

  adjustButton(key: string): Locator {
    return this.page.getByTestId(`stock-adjust-${key}`);
  }

  /** Open a variant's detail row (idempotent: a row already open stays open). */
  async expand(key: string): Promise<void> {
    const toggle = this.page.getByTestId(`stock-variant-toggle-${key}`);
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }

  async openCorrectionDialog(key: string): Promise<CorrectionDialog> {
    await this.expand(key);
    await expect(this.adjustButton(key)).toBeEnabled();
    await this.adjustButton(key).click();
    const dialog = new CorrectionDialog(this.page);
    await expect(dialog.root).toBeVisible();
    return dialog;
  }
}

export class CorrectionDialog {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByTestId('stock-correction-dialog');
  }

  get submit(): Locator {
    return this.page.getByTestId('stock-correction-submit');
  }

  get diff(): Locator {
    return this.page.getByTestId('stock-correction-diff');
  }

  get largeChange(): Locator {
    return this.page.getByTestId('stock-correction-large-change');
  }

  get applied(): Locator {
    return this.page.getByTestId('stock-correction-applied');
  }

  async setQuantity(quantity: number): Promise<void> {
    await this.page.getByTestId('stock-correction-mode-set').click();
    await this.page.getByTestId('stock-correction-quantity').fill(String(quantity));
  }

  async setDelta(delta: number): Promise<void> {
    await this.page.getByTestId('stock-correction-mode-delta').click();
    await this.page
      .getByTestId('stock-correction-delta')
      .fill(delta > 0 ? `+${delta}` : String(delta));
  }

  async acknowledgeLargeChange(): Promise<void> {
    await this.page.getByTestId('stock-correction-large-change-confirm').check();
  }

  async done(): Promise<void> {
    await this.page.getByTestId('stock-correction-done').click();
    await expect(this.root).toBeHidden();
  }
}
