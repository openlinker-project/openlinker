/**
 * "Cost prices" work list (#3591)
 *
 * `/products/cost-prices`: tabs sold / all / has-cost, search, channel filter,
 * inline cost entry per row and the bulk dialog for a selection.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { slugOf } from './variant-cost.page';

export type CostWorklistTab = 'sold' | 'all' | 'has-cost';

export class CostWorklistPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/products/cost-prices');
    await expect(this.page.getByTestId('cost-worklist-table').or(this.page.getByTestId('cost-worklist-done-empty'))
      .or(this.page.getByTestId('cost-worklist-readonly')).first()).toBeVisible();
  }

  get table(): Locator {
    return this.page.getByTestId('cost-worklist-table');
  }

  tab(tab: CostWorklistTab): Locator {
    return this.page.getByTestId(`cost-worklist-tab-${tab}`);
  }

  async selectTab(tab: CostWorklistTab): Promise<void> {
    await this.tab(tab).click();
    await expect(this.tab(tab)).toHaveAttribute('aria-selected', 'true');
  }

  get search(): Locator {
    return this.page.getByTestId('cost-worklist-search');
  }

  get channel(): Locator {
    return this.page.getByTestId('cost-worklist-channel');
  }

  get doneEmpty(): Locator {
    return this.page.getByTestId('cost-worklist-done-empty');
  }

  get readonlyNote(): Locator {
    return this.page.getByTestId('cost-worklist-readonly');
  }

  row(sku: string): Locator {
    return this.page.getByTestId(`cost-worklist-row-${slugOf(sku)}`);
  }

  async addInline(sku: string, amount: string, currency?: string): Promise<void> {
    await this.page.getByTestId(`cost-worklist-add-${slugOf(sku)}`).click();
    await this.page.getByTestId(`cost-worklist-input-${slugOf(sku)}`).fill(amount);
    if (currency) await this.page.getByTestId(`cost-worklist-currency-${slugOf(sku)}`).selectOption(currency);
    await this.page.getByTestId(`cost-worklist-save-${slugOf(sku)}`).click();
  }

  saved(sku: string): Locator {
    return this.page.getByTestId(`cost-worklist-saved-${slugOf(sku)}`);
  }

  cost(sku: string): Locator {
    return this.page.getByTestId(`cost-worklist-cost-${slugOf(sku)}`);
  }

  select(sku: string): Locator {
    return this.page.getByTestId(`cost-worklist-select-${slugOf(sku)}`);
  }

  get bulkBar(): Locator {
    return this.page.getByTestId('cost-worklist-bulk-bar');
  }

  get bulkDialog(): Locator {
    return this.page.getByTestId('cost-bulk-dialog');
  }

  async openBulk(): Promise<void> {
    await this.page.getByTestId('cost-worklist-bulk-open').click();
    await expect(this.bulkDialog).toBeVisible();
  }

  async fillBulk(amount: string, currency?: string): Promise<void> {
    await this.page.getByTestId('cost-bulk-input').fill(amount);
    if (currency) await this.page.getByTestId('cost-bulk-currency').selectOption(currency);
  }

  get bulkPreview(): Locator {
    return this.page.getByTestId('cost-bulk-preview');
  }

  get bulkError(): Locator {
    return this.page.getByTestId('cost-bulk-error');
  }

  async saveBulk(): Promise<void> {
    await this.page.getByTestId('cost-bulk-save').click();
  }
}
