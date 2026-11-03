/**
 * ksef-legal: bulk issue totals and the shared-NIP warning (DEF-21)
 *
 * - The bulk-issue banner reports "Issued X of N" against what was asked,
 *   and says when some orders were not reported back.
 * - Two KSeF connections on one seller NIP share one KSeF rate-limit budget;
 *   saving the second shows that warning and keeps it on screen instead of
 *   navigating past it.
 *
 * Unit/int-only, with reason: that the two connections really draw from ONE
 * Redis sliding window (DEF-05/06) needs a fake clock and two limiter
 * instances, which is ksef-rate-limiter.spec.ts and its Redis int-spec, not
 * something a browser can observe (H-09/H-10).
 *
 * The second connection is created disabled-by-the-end: it is disabled in a
 * `finally`, so it never issues anything.
 *
 * @module tests/ksef-legal
 */
import { test, expect } from '../../src/fixtures/test';
import { shot } from '../../src/support/shot';
import { requireKsef, ksefOrder } from './ksef-legal.helpers';

test.describe('ksef-legal: bulk totals and shared NIP', () => {
  test('the bulk banner reports issued against asked', async ({
    api,
    world,
    jobs,
    poll,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    testInfo.annotations.push({
      type: 'unit-only',
      description: 'one Redis window across connections: ksef-rate-limiter.spec.ts (H-09/H-10)',
    });
    // Two orders that already have a failed attempt, so they show on /invoices.
    // A public-sector buyer flag with no unit named is refused before KSeF
    // until the operator confirms it, which leaves a failed record behind; the
    // bulk issue carries no confirmation, so it is refused again and reported.
    const a = await ksefOrder({ api, world, jobs, poll });
    const b = await ksefOrder({ api, world, jobs, poll });
    for (const o of [a, b]) {
      await api.invoices
        .issue({
          connectionId: ksef.id,
          orderId: o.order.internalOrderId,
          buyerIsPublicSectorEntity: true,
        })
        .catch(() => undefined);
    }

    await page.goto(`/invoices?connectionId=${ksef.id}&status=failed`);
    for (const o of [a, b]) {
      // The list shows the order NUMBER; the internal id is only behind a copy button.
      const orderNumber = String(o.order.orderSnapshot['orderNumber'] ?? o.order.internalOrderId);
      const row = page.getByRole('row').filter({ hasText: orderNumber });
      await row.getByRole('checkbox', { name: /select invoice/i }).check();
    }
    await page.getByRole('button', { name: /issue invoices/i }).click();
    await page.getByRole('button', { name: 'Issue', exact: true }).click();
    const banner = page.getByText(/Bulk issue complete\./);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Issued \d+ of 2\./);
    await shot(page, testInfo, 'bulk-pacing/01-issued-x-of-n-banner');
  });

  test('a second connection on the same seller NIP warns about the shared budget', async ({
    api,
    world,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    const config = (await api.connections.getById(ksef.id)).config ?? {};
    const second = await api.connections.create({
      name: `KSeF shared-NIP probe ${Date.now().toString(36)}`,
      platformType: 'ksef',
      adapterKey: 'ksef.publicapi.v2',
      config,
      credentials: { authType: 'ksef-token', secret: 'e2e-placeholder-token-never-used' },
      enabledCapabilities: ['Invoicing'],
    });
    try {
      const warnings = (second as unknown as { warnings?: string[] }).warnings ?? [];
      expect(
        warnings.some((w) => /same adapter and seller tax id/.test(w)),
        warnings.join(' | ')
      ).toBe(true);

      await page.goto(`/connections/${second.id}/edit`);
      await page.getByRole('button', { name: /^Save/ }).click();
      const alert = page.getByText(/same adapter and seller tax id/).first();
      await expect(alert).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/connections/${second.id}/edit`));
      await shot(page, testInfo, 'bulk-pacing/02-shared-nip-warning-after-save');
    } finally {
      await api.connections.update(second.id, { status: 'disabled' });
    }
  });
});
