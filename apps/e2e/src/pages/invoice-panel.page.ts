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

  /** The multi-connection picker, present only when >1 invoicing connection exists. */
  get connectionPicker(): Locator {
    return this.page.locator('#invoice-connection');
  }

  /**
   * Pick the invoicing connection the assertions target.
   *
   * `OrderInvoicePanel` auto-resolves the connection only when the stack has
   * exactly ONE invoicing connection; with two or more (the demo stack runs
   * KSeF + inFakt) it starts unselected behind a picker, and the
   * provider-specific `invoiceDetailSection` slot — which owns the FA(3)
   * "View" action — never mounts until a choice is made. A no-op when the
   * picker is absent.
   */
  async selectConnection(connectionName: string): Promise<void> {
    // The panel renders a skeleton until the connections query settles, so the
    // picker's absence is only meaningful once loading has finished. The panel
    // was renamed from `.order-invoice-panel` (#2160); the old selector matched
    // nothing, so this method failed on every stack.
    await expect(this.panel).toBeVisible();
    await expect(this.page.locator('.sales-document-panel--loading')).toHaveCount(0);
    // The picker lives inside the manual-override disclosure and only exists
    // while no document has been issued; an issued invoice is locked to its
    // own connection, so there is nothing to pick.
    if ((await this.connectionPicker.count()) === 0) {
      return;
    }
    await this.openManualOverride();
    await this.connectionPicker.selectOption({ label: connectionName });
  }

  get panel(): Locator {
    return this.page.getByTestId('sales-document-panel');
  }

  /** Open the "Issue or register manually instead" disclosure (#2807). */
  async openManualOverride(): Promise<void> {
    // The panel renders one disclosure per document kind it could issue; the
    // invoice one is the one with the invoice picker / Issue invoice button.
    const disclosure = this.page
      .getByTestId('sales-document-why-connection')
      // A CSS locator, not a role query: the button sits inside a closed
      // <details> and is therefore hidden from the accessibility tree.
      .filter({ has: this.page.locator('.sales-document-panel__actions--issue') })
      .first();
    if ((await disclosure.getAttribute('open')) === null) {
      // `:scope >`: the disclosure nests a provider's own <details> (KSeF's
      // per-invoice options), whose summary a bare `summary` would also match.
      await disclosure.locator(':scope > summary').click();
    }
  }

  /** The manual "Issue invoice" button inside the disclosure. */
  get manualIssueButton(): Locator {
    return this.page.getByRole('button', { name: 'Issue invoice' });
  }

  /** DEF-20: the KSeF per-issue options disclosure. */
  get ksefIssueOptions(): Locator {
    return this.page.getByTestId('ksef-issue-options');
  }

  /** DEF-26: the callout for a document whose sale changed after it was made. */
  get afterIssueAttention(): Locator {
    return this.page.getByTestId('sales-document-after-issue-attention');
  }

  /** The confirm-and-proceed dialog (DEF-23/26/30/31). */
  get acknowledgeDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Check before you continue' });
  }

  /** DEF-02/03: the KOD I verification QR inside the FA(3) preview. */
  get verificationQr(): Locator {
    return this.page.locator('.ksef-fa3-view__verification-qr');
  }

  /** The FA(3) preview's annotations list (DEF-29). */
  get annotationsList(): Locator {
    return this.page.locator('.ksef-fa3-view__annotations');
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
