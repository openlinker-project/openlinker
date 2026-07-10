/**
 * Invoice panel page object (order detail)
 *
 * Covers the "Invoice" section on `/orders/:id` — not-issued (Issue), failed
 * (Retry), and issued (status badge + PDF link) states. Consumed by the
 * follow-up KSeF segment (S7).
 *
 * @module pages
 */
import { type Locator, type Page } from '@playwright/test';

export class InvoicePanel {
  constructor(private readonly page: Page) {}

  get section(): Locator {
    return this.page.getByRole('heading', { name: 'Invoice' });
  }

  get issueButton(): Locator {
    return this.page.getByRole('button', { name: 'Issue' });
  }
}
