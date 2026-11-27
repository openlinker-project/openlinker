/**
 * Buyer emails, opt-in per connection, end to end (#3554)
 *
 * Drives the real path a shop order takes: ingestion fires `order.received`,
 * the seeded "Buyer email: order confirmed" rule runs its `send-email` step,
 * the step goes through the connection's `config.buyerEmails` opt-in, and the
 * attempt lands on the order timeline (`GET /orders/:id/buyer-emails`).
 *
 * TWO ORDERS, ONE RULE. The first order is ingested with the connection NOT
 * opted in and must read `suppressed / emails-off-for-connection`; the second,
 * after opting in, must read `sent` (or `suppressed / no-buyer-address` on a
 * stack with `OL_STORE_PII=false`, where no address is stored). Asserting only
 * the second would pass against a gate that let everything through.
 *
 * MUTATING: synthesizes PrestaShop orders, arms the seeded rule and edits the
 * connection's config; both are restored in `finally`. Needs the seed migration
 * (`1937480000000`) to have run and a mailer bound in the worker (the console
 * mailer counts as `sent`).
 *
 * @module tests/order-ingestion
 */
import { test, expect } from '../../src/fixtures/test';
import {
  buildPrestashopWebserviceClient,
  resolvePrestashopStore,
  synthesizeOrder,
} from '../../src/support/order-synthesis';
import type { AutomationRuleView, BuyerEmailDeliveryView } from '../../src/api/api.types';

/** The seeded rule's fixed id, from `1937480000000-seed-buyer-email-automation-rules`. */
const ORDER_CONFIRMED_RULE_ID = '6c1f3a52-3554-4a00-8000-000000000001';

function toWriteInput(rule: AutomationRuleView, isActive: boolean) {
  return {
    name: rule.name,
    trigger: rule.trigger,
    triggerConfig: rule.triggerConfig,
    conditions: rule.conditions,
    actions: rule.actions,
    isActive,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
  };
}

test.describe('buyer emails: opt-in per connection (#3554)', () => {
  test('a shop order is emailed only once the connection opts in', async ({
    api,
    world,
    jobs,
    poll,
  }) => {
    test.skip(
      !buildPrestashopWebserviceClient(world),
      'needs OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) to synthesize PrestaShop orders'
    );
    const store = resolvePrestashopStore(world);
    test.skip(!store, 'needs an active PrestaShop connection');

    const rule = await api.automations.getById(ORDER_CONFIRMED_RULE_ID).catch(() => null);
    test.skip(!rule, 'the buyer-email seed migration has not run on this stack');

    const connection = await api.connections.getById(store!.id);
    const originalConfig = connection.config ?? {};

    const waitForEntry = (orderId: string): Promise<BuyerEmailDeliveryView[]> =>
      poll.until(
        () => api.buyerEmails.forOrder(orderId),
        (rows) => rows.some((row) => row.templateKey === 'order-confirmed'),
        { timeoutMs: 60_000, message: `a buyer-email entry for order ${orderId}` }
      );

    try {
      await api.automations.replace(rule!.id, toWriteInput(rule!, true));
      await api.connections.update(store!.id, {
        config: { ...originalConfig, buyerEmails: { enabled: false, templates: {} } },
      });

      const notOptedIn = await synthesizeOrder({ api, world, jobs, poll });
      const offRows = await waitForEntry(notOptedIn.order.internalOrderId);
      expect(offRows[0]).toMatchObject({
        templateKey: 'order-confirmed',
        outcome: 'suppressed',
        suppressionReason: 'emails-off-for-connection',
      });

      await api.connections.update(store!.id, {
        config: {
          ...originalConfig,
          buyerEmails: { enabled: true, templates: { 'order-confirmed': { enabled: true } } },
        },
      });

      const optedIn = await synthesizeOrder({ api, world, jobs, poll });
      const onRows = await waitForEntry(optedIn.order.internalOrderId);
      const entry = onRows.find((row) => row.templateKey === 'order-confirmed');
      expect(
        entry?.outcome === 'sent' ||
          (entry?.outcome === 'suppressed' && entry.suppressionReason === 'no-buyer-address'),
        `expected sent (or no-buyer-address under OL_STORE_PII=false), got ${JSON.stringify(entry)}`
      ).toBe(true);
      // The timeline never carries the buyer's address.
      expect(entry).not.toHaveProperty('recipient');
    } finally {
      await api.connections.update(store!.id, { config: originalConfig }).catch(() => undefined);
      await api.automations.replace(rule!.id, toWriteInput(rule!, rule!.isActive)).catch(() => undefined);
    }
  });
});
