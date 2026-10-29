/**
 * G06 sales document email - every UI state, one screenshot each (#3556)
 *
 * The order detail's "Email to buyer" control (#3551) on the seeded
 * sales-document orders (`seedSalesDocumentStates`, the fixture the
 * `sales-documents` project uses). One screenshot per state to
 * `screenshots/g06/`:
 *   - `invoice-ready`  - an issued, cleared KSeF invoice: recipient, language, Send;
 *   - `receipt-issued` - a registered fiscal receipt, with the summary note;
 *   - `email-sent`     - the send answered success;
 *   - `email-failed`   - the send was refused, its sentence shown verbatim;
 *   - `not-cleared`    - the authority has not settled the invoice: no send offered;
 *   - `no-document`    - nothing issued: no email control at all;
 *   - `viewer`         - a read-only role sees the document but no email control.
 *
 * `email-sent` and `email-failed` STUB the send route: the seeded connections
 * are fixtures with no provider behind them, so a real send could only be
 * refused. Golden path 1 in `golden-paths.spec.ts` sends for real.
 *
 * FIXTURE DATA: writes the seed rows directly in Postgres (the one exception
 * to this package's HTTP-only rule, shared with `tests/sales-documents`).
 *
 * @module tests/oms-mvp/g06
 */
import { test, expect } from '../../../src/fixtures/test';
import { shot } from '../../../src/support/shot';
import { provisionViewer, seedBrowserSession } from '../../../src/support/access-control';
import { SEED_ORDER_IDS, seedSalesDocumentStates } from '../../../src/support/sales-document-seed';

const FOLDER = 'g06';
const SEND_ROUTE = '**/invoices/*/send-email';

function orderUrl(id: string): string {
  return `/orders/${encodeURIComponent(id)}`;
}

test.describe('G06 sales document email - UI states (#3556)', () => {
  test.beforeAll(async () => {
    await seedSalesDocumentStates();
  });

  test('issued invoice: ready, sent and failed', async ({ page }, testInfo) => {
    await page.goto(orderUrl(SEED_ORDER_IDS.invoiceIssued));
    const control = page.getByTestId('send-document-email');
    await expect(control).toBeVisible();
    await expect(page.getByTestId('send-document-email-recipient')).toBeVisible();
    await expect(page.getByTestId('send-document-email-not-ready')).toHaveCount(0);
    await shot(control, testInfo, 'm24-invoice-ready', FOLDER);

    // email-sent
    await page.route(SEND_ROUTE, (route) =>
      route.fulfill({
        json: { delivered: true, recipient: 'buyer-edited@example.com', sentVia: 'openlinker' },
      })
    );
    await page.getByTestId('send-document-email-recipient').fill('buyer-edited@example.com');
    await page.getByTestId('send-document-email-button').click();
    await expect(page.getByText('Document emailed to buyer', { exact: true })).toBeVisible();
    await expect(page.getByTestId('send-document-email-error')).toHaveCount(0);
    await shot(page, testInfo, 'm24-email-sent', FOLDER);
    await page.unroute(SEND_ROUTE);

    // email-failed: the body the API sends for a `no-document` refusal
    // (`toDocumentEmailException`: 422, readable `message`, machine `code`).
    const refusal = 'The document has no file to attach yet.';
    await page.route(SEND_ROUTE, (route) =>
      route.fulfill({
        status: 422,
        json: { statusCode: 422, error: 'Unprocessable Entity', message: refusal, code: 'no-document' },
      })
    );
    await page.getByTestId('send-document-email-button').click();
    await expect(page.getByTestId('send-document-email-error')).toContainText(refusal);
    await shot(control, testInfo, 'm24-email-failed', FOLDER);
  });

  test('registered receipt offers the email with the summary note', async ({ page }, testInfo) => {
    await page.goto(orderUrl(SEED_ORDER_IDS.fiscalRegistered));
    await expect(page.getByTestId('receipt-email-summary-note')).toBeVisible();
    const control = page.getByTestId('send-document-email');
    await expect(control).toBeVisible();
    await shot(page.getByTestId('sales-document-panel'), testInfo, 'm24-receipt-issued', FOLDER);
  });

  test('an invoice the authority has not settled offers no send', async ({ page }, testInfo) => {
    await page.goto(orderUrl(SEED_ORDER_IDS.invoiceAtAuthorityDuplicate));
    await expect(page.getByTestId('send-document-email-not-ready')).toBeVisible();
    await expect(page.getByTestId('send-document-email-button')).toBeDisabled();
    await shot(page.getByTestId('send-document-email'), testInfo, 'm24-not-cleared', FOLDER);
  });

  test('an order with no issued document has no email control', async ({ page }, testInfo) => {
    await page.goto(orderUrl(SEED_ORDER_IDS.invoiceNotIssued));
    await expect(page.getByTestId('sales-document-panel')).toBeVisible();
    await expect(page.getByTestId('send-document-email')).toHaveCount(0);
    await shot(page.getByTestId('sales-document-panel'), testInfo, 'm24-no-document', FOLDER);
  });

  test('a viewer sees the document but no email control', async ({ page, api, env }, testInfo) => {
    const viewer = await provisionViewer(env, api);
    test.skip(viewer === null, 'Could not provision a viewer account on this stack.');
    await seedBrowserSession(page.context(), env, viewer!.creds);

    await page.goto(orderUrl(SEED_ORDER_IDS.invoiceIssued));
    await expect(page.getByTestId('sales-document-panel')).toBeVisible();
    await expect(page.getByTestId('send-document-email')).toHaveCount(0);
    await shot(page.getByTestId('sales-document-panel'), testInfo, 'm24-viewer', FOLDER);
  });
});
