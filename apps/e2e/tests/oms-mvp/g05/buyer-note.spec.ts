/**
 * G05 golden paths 1 and 4 - buyer note (#3546)
 *
 * Path 1: an order with a buyer note shows it on order detail, the operator
 * marks it read, and the read state survives a reload.
 *
 * Path 4: a packer opens the parcel of an order carrying a buyer note on
 * `/bench`, acknowledges it, and the order's Activity reads "Buyer note read at
 * the bench".
 *
 * Seeding note: the issue names an Allegro order, but a sandbox cannot be made
 * to produce a checkout note on demand. Both paths use `order_records` rows
 * written by `support/oms-mvp-g05-seed.ts`; the UI under test (note block,
 * mark-read, bench acknowledgement) does not depend on which channel the
 * order came from.
 *
 * @module tests/oms-mvp/g05
 */
import { test, expect } from '../../../src/fixtures/test';
import { readSystemConfig } from '../../../src/support/access-control';
import { provisionPacker, seedPackerBrowserSession } from '../../../src/support/provision-packer';
import { clearBenchSeed } from '../../../src/support/bench-seed';
import {
  G05_NOTE_TEXT,
  clearG05Seed,
  seedBenchOrderWithBuyerNote,
  seedBuyerNoteOrders,
} from '../../../src/support/oms-mvp-g05-seed';

test.describe('G05 golden path 1 - buyer note read (#3546)', () => {
  test.afterAll(async () => {
    await clearG05Seed();
  });

  test('should keep the buyer note read after a reload when the operator marks it read', async ({
    page,
  }) => {
    const [orderId] = await seedBuyerNoteOrders();

    await page.goto(`/orders/${orderId}`);
    const note = page.getByTestId('order-buyer-note');
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('data-state', 'unread');
    await expect(page.getByTestId('order-buyer-note-text')).toContainText(G05_NOTE_TEXT);

    await page.getByTestId('order-buyer-note-mark-read').click();
    await expect(note).toHaveAttribute('data-state', 'read');

    await page.reload();
    await expect(page.getByTestId('order-buyer-note')).toHaveAttribute('data-state', 'read');
    await expect(page.getByTestId('order-buyer-note-mark-read')).toHaveCount(0);
  });
});

test.describe('G05 golden path 4 - bench acknowledgement (#3546)', () => {
  test.afterAll(async () => {
    await clearBenchSeed();
  });

  test('should show "Buyer note read at the bench" in Activity when a packer acknowledges the note', async ({
    page,
    api,
    env,
  }) => {
    const config = await readSystemConfig(env);
    test.skip(
      config.demoMode,
      'bench packer provisioning needs an admin-approvable registration, unavailable in demo mode (#1624)',
    );
    const packer = await provisionPacker(env, api);
    test.skip(packer === null, 'no packer available - registration disabled or rate-limited on this stack');

    const { seed, internalOrderId } = await seedBenchOrderWithBuyerNote();

    await seedPackerBrowserSession(page.context(), env, packer!.creds);
    await page.goto('/bench');
    await page
      .locator('[data-testid="bench-work-row"]')
      .filter({ hasText: seed.orderReference })
      .getByRole('button', { name: 'Open parcel' })
      .click();

    const benchNote = page.getByTestId('bench-buyer-note');
    await expect(benchNote).toBeVisible();
    await expect(benchNote).toHaveAttribute('data-state', 'unread');
    await expect(page.getByTestId('bench-buyer-note-text')).toContainText(G05_NOTE_TEXT);

    await page.getByTestId('bench-buyer-note-acknowledge').click();
    await expect(benchNote).toHaveAttribute('data-state', 'read');
    await expect(page.getByTestId('bench-buyer-note-read-badge')).toBeVisible();

    // Back to the operator's session: the acknowledgement is part of the
    // order's own Activity timeline.
    await page.context().clearCookies();
    const login = await page.context().request.post(`${env.apiUrl}/v1/auth/login`, {
      data: { username: env.adminUser, password: env.adminPass },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(login.ok()).toBe(true);

    await page.goto(`/orders/${internalOrderId}`);
    await expect(page.getByText('Buyer note read at the bench')).toBeVisible();
    await expect(page.getByTestId('order-buyer-note-bench-ack')).toBeVisible();
  });
});
