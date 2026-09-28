/**
 * G03 golden path 2 — export and download, viewer refused (#3536)
 *
 * Export the filtered `/orders` view to CSV, wait for the `orders.export`
 * job, download the file; as a viewer, the Export button is absent and a
 * direct download request is refused (D35).
 *
 * @module tests/oms-mvp/g03
 */
import { test, expect } from '../../../src/fixtures/test';
import { provisionViewer, seedBrowserSession } from '../../../src/support/access-control';

test.describe('G03 golden path 2 — export (#3536)', () => {
  test('admin exports the current view to CSV and downloads it', async ({ page, poll }) => {
    await page.goto('/orders');
    await page.getByRole('button', { name: 'Export' }).click();

    const dialog = page.getByTestId('order-export-dialog');
    await expect(dialog).toHaveAttribute('data-mk-state', /default|selected|large/);

    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export' }).click();

    // #3534 — the run is `pending` until the worker generates the file;
    // the dialog polls every 2 s (`useOrderExportRunQuery`).
    await poll.until(
      () => dialog.getAttribute('data-mk-state'),
      (state) => state !== 'preparing',
      { timeoutMs: 60_000, message: 'export run to leave preparing' },
    );
    await expect(dialog).toHaveAttribute('data-mk-state', 'ready');

    await dialog.getByRole('button', { name: 'Download file' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('a viewer sees no Export button and a direct download is refused', async ({ page, api, env }) => {
    const viewer = await provisionViewer(env, api);
    test.skip(viewer === null, 'Could not provision a viewer account on this stack.');
    await seedBrowserSession(page.context(), env, viewer!.creds);

    await page.goto('/orders');
    await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);

    // Direct API refusal (D35: orders:export is admin/operator only) — the
    // UI hiding the button is not the security boundary, the route is.
    const response = await page.context().request.post(`${env.apiUrl}/v1/orders/export`, {
      data: { format: 'csv', scope: 'filtered' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status()).toBe(403);
  });
});
