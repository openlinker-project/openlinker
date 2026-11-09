/**
 * G06 buyer emails - every UI state, one screenshot each (#3556)
 *
 * Drives the real app (#3555) to the six buyer-email states and saves a
 * screenshot of each to `screenshots/g06/`:
 *   - `list`, `list-loading`, `editor`, `editor-sent` on Settings -> Buyer emails;
 *   - `order-suppressed`, `order-bounced` on the order detail panel.
 *
 * The settings states run against the real API, and the test send really
 * goes through the stack's mailer (the console mailer counts). Nothing is
 * saved: the editor is left without "Save changes", so the connection and the
 * rules stay as they were.
 *
 * The two order states render a STUBBED `GET /orders/:id/buyer-emails`: a
 * real bounce needs a mail server that refuses the address, which the dev
 * stack does not have. The stub only feeds the panel; that real outcomes are
 * recorded is covered by `golden-paths.spec.ts`.
 *
 * @module tests/oms-mvp/g06
 */
import { test, expect } from '../../../src/fixtures/test';
import { shot } from '../../../src/support/shot';

const FOLDER = 'g06';

function deliveryRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `stub-${String(overrides.outcome)}-${String(overrides.templateKey)}`,
    connectionId: 'stub-connection',
    templateKey: 'order-confirmed',
    subjectRef: 'stub-order',
    outcome: 'sent',
    suppressionReason: null,
    suppressionMessage: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test.describe('G06 buyer emails - UI states (#3556)', () => {
  test('settings: list-loading, list, editor and editor-sent', async ({ page, api }, testInfo) => {
    const connections = await api.connections.list();
    const shop = connections.find(
      (connection) =>
        connection.status === 'active' &&
        connection.enabledCapabilities.includes('OrderSource') &&
        connection.enabledCapabilities.includes('ProductMaster')
    );
    test.skip(!shop, 'needs an active shop connection that takes orders');

    // list-loading: hold the connections read until the screenshot is taken.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Only the API read: a glob like `**/connections*` would also catch a
    // lazily loaded JS chunk whose file name starts with "connections".
    const connectionsRead = (url: URL): boolean => /\/connections$/.test(url.pathname);
    await page.route(connectionsRead, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`/settings/buyer-emails?connection=${encodeURIComponent(shop!.id)}`);
    const loading = page.getByTestId('buyer-emails-loading');
    await expect(loading).toHaveAttribute('data-mk-state', 'list-loading');
    await shot(page, testInfo, 'm21-list-loading', FOLDER);
    release();

    // list. Unroute only once the held read has gone through: unrouting while
    // its handler still waits makes Playwright settle the route itself, and the
    // handler's own continue() then throws "Route is already handled".
    const list = page.getByTestId('buyer-emails-list');
    await expect(list).toHaveAttribute('data-mk-state', 'list');
    await page.unroute(connectionsRead);
    await expect(page.getByTestId('buyer-emails-off-note')).toBeVisible();
    await expect(page.getByTestId('buyer-email-template-row')).toHaveCount(4);
    await shot(page, testInfo, 'm21-list', FOLDER);

    // editor
    await page
      .locator('[data-testid="buyer-email-template-row"][data-template="shipped"]')
      .getByTestId('buyer-email-template-edit')
      .click();
    const editor = page.getByTestId('buyer-email-editor');
    await expect(editor).toHaveAttribute('data-mk-state', 'editor');
    await expect(page.getByTestId('buyer-email-preview')).toBeVisible();
    await shot(page, testInfo, 'm21-editor', FOLDER);

    // editor-sent: a real test send through the stack's mailer.
    await page.getByTestId('buyer-email-test-to').fill('g06-e2e@example.com');
    await page.getByTestId('buyer-email-test-send').click();
    await expect(page.getByTestId('buyer-email-test-sent')).toContainText('g06-e2e@example.com');
    await expect(editor).toHaveAttribute('data-mk-state', 'editor-sent');
    await shot(page, testInfo, 'm21-editor-sent', FOLDER);
  });

  test('order: suppressed with its reason, and bounced distinct from sent', async ({ page, api }, testInfo) => {
    const orders = await api.orders.list({ limit: 1 });
    const order = orders.items.at(0);
    test.skip(!order, 'needs at least one order on the stack');
    const orderUrl = `/orders/${encodeURIComponent(order!.internalOrderId)}`;
    const historyRoute = `**/orders/${order!.internalOrderId}/buyer-emails`;

    // order-suppressed
    await page.route(historyRoute, (route) =>
      route.fulfill({
        json: [
          deliveryRow({
            outcome: 'suppressed',
            suppressionReason: 'emails-off-for-connection',
            suppressionMessage: "Buyer emails are off for this order's connection.",
          }),
        ],
      })
    );
    await page.goto(orderUrl);
    const panel = page.getByTestId('order-buyer-emails');
    await expect(panel).toHaveAttribute('data-mk-state', 'order-suppressed');
    await expect(page.getByTestId('order-buyer-email-reason')).toContainText(
      "Buyer emails are off for this order's connection."
    );
    await shot(panel, testInfo, 'm21-order-suppressed', FOLDER);
    await page.unroute(historyRoute);

    // order-bounced
    await page.route(historyRoute, (route) =>
      route.fulfill({
        json: [
          deliveryRow({ outcome: 'sent' }),
          deliveryRow({ outcome: 'bounced', templateKey: 'shipped' }),
        ],
      })
    );
    await page.reload();
    await expect(panel).toHaveAttribute('data-mk-state', 'order-bounced');
    const outcomes = await page
      .getByTestId('order-buyer-email-row')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-outcome')));
    expect(outcomes).toEqual(['sent', 'bounced']);
    await expect(page.getByTestId('order-buyer-email-bounce')).toBeVisible();
    await shot(panel, testInfo, 'm21-order-bounced', FOLDER);
  });
});
