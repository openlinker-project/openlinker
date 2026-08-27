/**
 * PrestaShop Order-State Semantics
 *
 * Pure rules for reading what one `ps_order_state` row MEANS, so no code path
 * has to know an id.
 *
 * PrestaShop order-state ids are shop data, not protocol. A merchant renames
 * states, deletes them, adds "Awaiting courier pickup" and "Sent to
 * accounting", and an id that means "Canceled" on a clean install means
 * something else on the shop next door. The adapter used to carry the
 * default-install table 1-7 and read every custom state as `pending`, silently
 * (#2607).
 *
 * The state row itself carries PrestaShop's own answer. `delivered`, `shipped`
 * and `paid` are the flags PrestaShop uses internally to decide whether to show
 * a tracking link or send a shipped email, so they are as authoritative as
 * anything the WebService exposes.
 *
 * Cancellation and refund have no flag of their own - `ps_order_state` has no
 * such column, and PrestaShop identifies those states through configuration
 * keys instead. So they are read from the state's own labels, across every
 * language the row carries. That is the same rule the fulfillment-status
 * mapper (#834) already applied to cancellation, generalised here to every
 * status the order feed reports.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import type { OrderStatus } from '@openlinker/core/orders';

import type { PrestashopOrderState } from '../../domain/types/prestashop-options.types';

const TRUE_VALUES: ReadonlySet<string> = new Set(['1', 'true']);

/**
 * Latin-script cancellation vocabulary. Non-Latin scripts (HU, RU, UA, BG) are
 * a known gap; a shop in one of those languages needs the operator's own
 * order-state mapping, which is consulted before any derivation.
 */
const CANCEL_REGEX = /cancel|annul|anul|storno|reject|abge/i;

/**
 * Refund vocabulary, same Latin-script caveat. Checked after cancellation
 * because a refund label rarely also matches the cancel one, and never before
 * the flags: a state can be both refunded and shipped, and what the operator
 * needs to know first is where the parcel is.
 */
const REFUND_REGEX = /refund|rembours|zwrot|rimbors|reembols|erstatt|storniert/i;

/**
 * True for PrestaShop's `'1'` / `1` / `'true'` flag spellings.
 */
export function isTruthyStateFlag(value: string | number | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return TRUE_VALUES.has(String(value));
}

/**
 * Every label a state row carries.
 *
 * `name` is a flat string on a single-language install and the multi-language
 * shape (`{ language: [{ '#text': … }] }`) otherwise. All labels are read, so a
 * multilingual shop does not depend on which language happens to come first.
 */
export function extractOrderStateLabels(name: PrestashopOrderState['name']): readonly string[] {
  if (typeof name === 'string') {
    return [name];
  }
  if (name === null || name === undefined || typeof name !== 'object') {
    return [];
  }

  const language = (name as Record<string, unknown>)['language'];
  const labels: string[] = [];

  if (Array.isArray(language)) {
    for (const entry of language) {
      const label = extractTextLabel(entry);
      if (label !== null) {
        labels.push(label);
      }
    }
  } else if (language !== null && typeof language === 'object') {
    const label = extractTextLabel(language);
    if (label !== null) {
      labels.push(label);
    }
  }

  return labels;
}

/**
 * True when any of the state's labels reads as a cancellation.
 */
export function isCancelledOrderState(state: PrestashopOrderState): boolean {
  return extractOrderStateLabels(state.name).some((label) => CANCEL_REGEX.test(label));
}

/**
 * True when any of the state's labels reads as a refund.
 */
export function isRefundedOrderState(state: PrestashopOrderState): boolean {
  return extractOrderStateLabels(state.name).some((label) => REFUND_REGEX.test(label));
}

/**
 * Derive the neutral order status one state row stands for.
 *
 * Order of the tests is the point. `delivered` and `shipped` come first because
 * they are the shop's own flags and beat any label reading. `paid` alone is
 * `processing`: money has arrived and nothing has left the warehouse. A state
 * with no flag and no recognised label is `pending`, which is what an
 * unstarted order is - the difference from before is that a custom shipped or
 * paid state is no longer swept into it.
 */
export function deriveOrderStatusFromState(state: PrestashopOrderState): OrderStatus {
  if (isTruthyStateFlag(state.delivered)) {
    return 'delivered';
  }
  if (isTruthyStateFlag(state.shipped)) {
    return 'shipped';
  }
  if (isCancelledOrderState(state)) {
    return 'cancelled';
  }
  if (isRefundedOrderState(state)) {
    return 'refunded';
  }
  if (isTruthyStateFlag(state.paid)) {
    return 'processing';
  }
  return 'pending';
}

function extractTextLabel(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    if (typeof text === 'string') {
      return text;
    }
  }
  return null;
}
