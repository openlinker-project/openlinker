/**
 * Buyer-email E2E helpers (#3556)
 *
 * Arm a seeded buyer-email rule, set a connection's `config.buyerEmails`, and
 * wait for an order's buyer-email history - each change paired with a
 * restore, so a spec can leave the stack as it found it.
 *
 * The seeded rule is found by its `send-email` step's `buyerEmailTemplate`,
 * never by its id, the same way the settings page finds it.
 *
 * @module support
 */
import type { ApiClient } from '../api/api-client';
import type {
  AutomationRuleView,
  AutomationRuleWriteInput,
  BuyerEmailDeliveryView,
} from '../api/api.types';
import type { Poller } from './poller';

export type BuyerEmailTemplate = 'order-confirmed' | 'shipped' | 'document-issued' | 'return-received';

const TRIGGER: Record<BuyerEmailTemplate, string> = {
  'order-confirmed': 'order.received',
  shipped: 'order.shipped',
  'document-issued': 'order.document_issued',
  'return-received': 'return.received',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The seeded rule for a template, or `null` when the seed migration has not run. */
export async function findBuyerEmailRule(
  api: ApiClient,
  template: BuyerEmailTemplate
): Promise<AutomationRuleView | null> {
  const rules = await api.automations.listByTrigger(TRIGGER[template]);
  return (
    rules.find((rule) =>
      rule.actions.some(
        (action) => isRecord(action) && action.buyerEmailTemplate === template
      )
    ) ?? null
  );
}

function writeInput(rule: AutomationRuleView, isActive: boolean): AutomationRuleWriteInput {
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

/** Arm the rule; the returned function puts its previous `isActive` back. */
export async function armRule(api: ApiClient, rule: AutomationRuleView): Promise<() => Promise<void>> {
  await api.automations.replace(rule.id, writeInput(rule, true));
  return async () => {
    await api.automations.replace(rule.id, writeInput(rule, rule.isActive));
  };
}

/** Replace `config.buyerEmails`; the returned function restores the whole previous config. */
export async function setBuyerEmails(
  api: ApiClient,
  connectionId: string,
  buyerEmails: Record<string, unknown>
): Promise<() => Promise<void>> {
  const connection = await api.connections.getById(connectionId);
  const original = connection.config ?? {};
  await api.connections.update(connectionId, { config: { ...original, buyerEmails } });
  return async () => {
    await api.connections.update(connectionId, { config: original });
  };
}

/**
 * Wait until the order's newest row for this template has a FINAL outcome
 * (not `pending`, the slot claimed before the send), and return it.
 */
export async function waitForBuyerEmail(
  api: ApiClient,
  poll: Poller,
  internalOrderId: string,
  template: BuyerEmailTemplate,
  timeoutMs = 120_000
): Promise<BuyerEmailDeliveryView> {
  const rows = await poll.until(
    () => api.buyerEmails.forOrder(internalOrderId),
    (list) => {
      const newest = list.find((row) => row.templateKey === template);
      return newest !== undefined && newest.outcome !== 'pending';
    },
    { timeoutMs, intervalMs: 3_000, message: `a "${template}" buyer email on order ${internalOrderId}` }
  );
  const row = rows.find((candidate) => candidate.templateKey === template);
  if (!row) throw new Error(`no "${template}" buyer email on order ${internalOrderId}`);
  return row;
}
