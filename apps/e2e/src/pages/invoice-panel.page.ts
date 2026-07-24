/**
 * Invoice panel page object (order detail)
 *
 * Covers the "Invoice" section on `/orders/:id` — not-issued (Issue), failed
 * (Retry), and issued (status badge + PDF link) states, plus the KSeF-specific
 * `invoiceDetailSection` slot (`KsefInvoiceDetailSection`): the FA(3) "View"
 * action and its rendered `.doc-preview` (#1573, scenario 6 — the rebuilt
 * FA(3) preview, #1528).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class InvoicePanel {
  constructor(private readonly page: Page) {}

  get section(): Locator {
    return this.page.getByRole('heading', { name: 'Invoice' });
  }

  get issueButton(): Locator {
    return this.page.getByRole('button', { name: 'Issue' });
  }

  /** "View" action for the FA(3) document (KSeF invoice detail section). */
  get fa3ViewButton(): Locator {
    // `exact` so it doesn't also match the sibling "Preview" button (both are
    // ghost buttons in the KSeF invoice detail section).
    return this.page.getByRole('button', { name: 'View', exact: true });
  }

  /** The rendered FA(3) preview area (`.doc-preview`). */
  get fa3Preview(): Locator {
    return this.page.locator('.doc-preview');
  }

  /** The FA(3) preview's line-items table (`KsefFa3View`). */
  get fa3LineItemsTable(): Locator {
    return this.page.locator('.ksef-fa3-view__table');
  }

  /** Click "View" and wait for the FA(3) preview table to render. */
  async openFa3Preview(): Promise<void> {
    await this.fa3ViewButton.click();
    await expect(this.fa3LineItemsTable.first()).toBeVisible();
  }
}
