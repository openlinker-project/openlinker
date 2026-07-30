/**
 * Orders list + detail page objects
 *
 * `OrdersListPage` covers `/orders` (KPI strip + DataTable); `OrderDetailPage`
 * covers `/orders/:internalOrderId` and the composed invoice panel.
 * Primarily consumed by the follow-up post-purchase segments (S5-S9).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { InvoicePanel } from './invoice-panel.page';

export class OrdersListPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/orders');
    await expect(this.page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
  }

  get sourceFilter(): Locator {
    return this.page.getByRole('combobox', { name: 'Filter by source' });
  }

  /** A row locator matched by visible text (order id/number/customer). */
  row(text: string): Locator {
    return this.page.getByRole('row').filter({ hasText: text });
  }

  async open(internalOrderId: string): Promise<OrderDetailPage> {
    await this.page.goto(`/orders/${internalOrderId}`);
    const detail = new OrderDetailPage(this.page);
    await detail.expectVisible();
    return detail;
  }
}

export class OrderDetailPage {
  constructor(private readonly page: Page) {}

  async expectVisible(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Order detail' })).toBeVisible();
  }

  // No `shipment` accessor: the shipping suite drives dispatch through the API
  // (`src/support/shipments.ts`), never through the order-detail panel, so the
  // panel page object was deleted rather than left to drift against `apps/web`.
  get invoice(): InvoicePanel {
    return new InvoicePanel(this.page);
  }
}
