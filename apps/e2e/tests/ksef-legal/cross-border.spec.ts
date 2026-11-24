/**
 * ksef-legal: cross-border sales (DEF-01 / DEF-18)
 *
 * Since ADR-063 the cross-border guard protects ONE case: a line with no rate
 * of its own, which would fall back to the connection's domestic default.
 * When the shop states the line's rate, the band was chosen where the
 * catalogue lives and the guard steps aside. This spec checks what is
 * reachable on a live stack:
 *
 * - `allowCrossBorder` must be a boolean; the string `"true"` is refused at
 *   save rather than read as on;
 * - the switch is on the connection form, worded as the operator's decision;
 * - a foreign buyer on a line that carries the shop's rate is issued, the
 *   guard stepping aside by design.
 *
 * Unit-only, with reason: the refusal itself (`failureMode: 'rejected'`, safe
 * retry) needs a line with NO catalogue rate, and on this stack the shop
 * answers a rate for every product. fa3-cross-border-guard.spec.ts and
 * ksef-invoicing.adapter.spec.ts cover it.
 *
 * @module tests/ksef-legal
 */
import { test, expect } from '../../src/fixtures/test';
import { shot } from '../../src/support/shot';
import { failureOf, ksefOrder, requireKsef, waitForAccepted } from './ksef-legal.helpers';

test.describe('ksef-legal: cross-border', () => {
  test('the switch is a checked boolean, and a shop-rated foreign sale is issued', async ({
    api,
    world,
    jobs,
    poll,
    page,
  }, testInfo) => {
    const ksef = requireKsef(world);
    testInfo.annotations.push({
      type: 'unit-only',
      description:
        'refusal of a rate-less foreign line: fa3-cross-border-guard.spec.ts (shop rates every product here)',
    });
    const original = (await api.connections.getById(ksef.id)).config ?? {};

    const stringTrue = await failureOf(
      api.connections.update(ksef.id, { config: { ...original, allowCrossBorder: 'true' } })
    );
    expect(stringTrue?.status, 'a string is not a boolean').toBe(400);

    await page.goto(`/connections/${ksef.id}/edit`);
    await expect(page.getByRole('checkbox', { name: /Allow cross-border invoices/ })).toBeVisible();
    await shot(page, testInfo, 'cross-border/01-toggle-in-connection-form');

    const synthesized = await ksefOrder({ api, world, jobs, poll }, { buyerCountryIso: 'DE' });
    const items = synthesized.order.orderSnapshot['items'] as
      | Array<{ taxRate?: string }>
      | undefined;
    testInfo.annotations.push({
      type: 'line-rate',
      description: String(items?.[0]?.taxRate ?? 'none'),
    });
    await api.invoices.issue({ connectionId: ksef.id, orderId: synthesized.order.internalOrderId });
    const outcome = await waitForAccepted(
      { api, jobs, poll },
      ksef,
      synthesized.order.internalOrderId
    );
    testInfo.annotations.push({ type: 'clearance', description: String(outcome.regulatoryStatus) });
    expect(outcome.status, 'the shop chose the band, so the guard steps aside').toBe('issued');
    await page.goto(`/orders/${synthesized.order.internalOrderId}`);
    await shot(
      page.getByTestId('sales-document-panel'),
      testInfo,
      'cross-border/02-shop-rated-foreign-sale-issued'
    );
  });
});
