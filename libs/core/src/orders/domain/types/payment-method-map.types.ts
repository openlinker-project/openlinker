/**
 * Operator-defined payment-method map (#3774)
 *
 * An order source reports its OWN payment identifier verbatim
 * (`IncomingOrder.sourcePaymentMethod` - a PrestaShop module name, a
 * WooCommerce gateway id) and maps onto the neutral `PaymentMethod` only the
 * identifiers its platform itself defines (#3294). Everything else reads
 * `unknown`, deliberately: a module name alone is not evidence of how the buyer
 * paid, and a wrong guess would pre-fill a wrong COD amount on a courier label.
 *
 * This file is the operator's way to say what THEIR gateways mean. The map
 * lives on `Connection.config.paymentMethodMap` (JSONB, no migration) as
 * `{ <source identifier>: <PaymentMethod> }`.
 *
 * Three rules are load-bearing, and all of them live here so no caller can
 * restate them:
 *
 * 1. **Normalisation is ONE function.** Keys are trimmed and lower-cased, on the
 *    map's keys (`readPaymentMethodMap`) AND on the looked-up identifier
 *    (`resolveSourcePaymentMethod`). An adapter reports `PayU` verbatim - it is
 *    also the destination-mapping key (#3474) and must stay as the source sent
 *    it - so only the map lookup is case- and whitespace-insensitive.
 * 2. **The operator map only FILLS an `unknown`.** A platform-defined answer
 *    (`ps_cashondelivery`, `cod`, ...) always wins: its meaning is fixed by the
 *    platform and is not the operator's to redefine.
 * 3. **`unknown` is never a map value.** Mapping a gateway to `unknown` is the
 *    same statement as not mapping it, so it is dropped on read rather than
 *    carried as an entry that decides nothing.
 *
 * One resolver serves both the order-source adapters and the discovery read, so
 * what the endpoint reports and what ingestion writes cannot drift.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { ConnectionConfig } from '@openlinker/core/identifier-mapping';
import { PAYMENT_METHOD, isPaymentMethod } from './payment-method.types';
import type { PaymentMethod } from './payment-method.types';

/** Config key holding the per-connection map on `Connection.config`. */
export const PAYMENT_METHOD_MAP_CONFIG_KEY = 'paymentMethodMap';

/** Who decided a resolved method. */
export const PaymentMethodResolutionValues = ['platform', 'operator', 'none'] as const;
export type PaymentMethodResolution = (typeof PaymentMethodResolutionValues)[number];

export interface ResolvedSourcePaymentMethod {
  readonly method: PaymentMethod;
  readonly resolvedBy: PaymentMethodResolution;
}

/**
 * The one place a source identifier becomes a map key: trimmed and lower-cased.
 * Returns `''` for a blank identifier, which never matches anything.
 */
export function normalizeSourcePaymentMethodKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Read the per-connection map, defensively (the column is JSONB).
 *
 * A missing or non-object value yields an empty map. Entries with a blank key,
 * a non-string value, a value outside `PaymentMethodValues` or the value
 * `unknown` are dropped. When two keys normalise to the same value the LAST one
 * wins - the write path refuses such a map outright
 * ({@link findPaymentMethodMapKeyCollisions}), so this only matters for a
 * config written around that gate.
 */
export function readPaymentMethodMap(
  config: ConnectionConfig | null | undefined
): ReadonlyMap<string, PaymentMethod> {
  const map = new Map<string, PaymentMethod>();
  const raw = config?.[PAYMENT_METHOD_MAP_CONFIG_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return map;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeSourcePaymentMethodKey(key);
    if (normalized === '' || !isPaymentMethod(value) || value === PAYMENT_METHOD.Unknown) {
      continue;
    }
    map.set(normalized, value);
  }
  return map;
}

/**
 * Keys of a candidate map that collide after normalisation, grouped.
 *
 * `{ "PayU": "online", "payu": "bank_transfer" }` would otherwise let JSON key
 * order decide the operator's intent, so the save path refuses it. Identical
 * values are refused too, for one rule instead of two. Each returned group
 * lists the ORIGINAL spellings (two or more); blank keys are not collisions.
 */
export function findPaymentMethodMapKeyCollisions(map: Record<string, unknown>): string[][] {
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(map)) {
    const normalized = normalizeSourcePaymentMethodKey(key);
    if (normalized === '') {
      continue;
    }
    groups.set(normalized, [...(groups.get(normalized) ?? []), key]);
  }
  return [...groups.values()].filter((keys) => keys.length > 1);
}

/**
 * Resolve the neutral method for one order.
 *
 * - the platform's own answer wins whenever it is not `unknown`;
 * - otherwise a map hit (the lookup key is normalised here, not by the caller);
 * - otherwise `unknown`.
 *
 * A blank or absent identifier never matches the map.
 */
export function resolveSourcePaymentMethod(input: {
  readonly platformMethod: PaymentMethod;
  readonly sourcePaymentMethod: string | undefined;
  readonly map: ReadonlyMap<string, PaymentMethod>;
}): ResolvedSourcePaymentMethod {
  if (input.platformMethod !== PAYMENT_METHOD.Unknown) {
    return { method: input.platformMethod, resolvedBy: 'platform' };
  }
  if (input.sourcePaymentMethod !== undefined) {
    const key = normalizeSourcePaymentMethodKey(input.sourcePaymentMethod);
    const mapped = key === '' ? undefined : input.map.get(key);
    if (mapped !== undefined) {
      return { method: mapped, resolvedBy: 'operator' };
    }
  }
  return { method: PAYMENT_METHOD.Unknown, resolvedBy: 'none' };
}
