/**
 * Payment-method map, browser side (#3775)
 *
 * Reads `Connection.config.paymentMethodMap` (`{ <gateway id>: <PaymentMethod> }`,
 * #3774) into form state. The browser cannot import `@openlinker/core` (#591),
 * so the key normalisation (trim + lower-case) is a deliberate mirror of core's
 * `normalizeSourcePaymentMethodKey`: a hand-typed `PayU` must line up with the
 * observed `payu` the backend reports, or the section would show two rows for
 * one gateway.
 *
 * @module features/connections/lib
 */
import {
  PaymentMethodValues,
  type PaymentMethod,
} from '../../../shared/types/payment-method.types';

/** Config key holding the map. Mirrors `PAYMENT_METHOD_MAP_CONFIG_KEY` in core. */
export const PAYMENT_METHOD_MAP_CONFIG_KEY = 'paymentMethodMap';

/** What an operator may choose: every neutral method except `unknown`. */
export const MAPPABLE_PAYMENT_METHODS = PaymentMethodValues.filter(
  (value): value is Exclude<PaymentMethod, 'unknown'> => value !== 'unknown',
);

/** A form cell: a mappable method, or `''` for "not set". */
export type PaymentMethodChoice = Exclude<PaymentMethod, 'unknown'> | '';

export function normalizePaymentMethodKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isMappablePaymentMethod(value: unknown): value is Exclude<PaymentMethod, 'unknown'> {
  return (MAPPABLE_PAYMENT_METHODS as readonly unknown[]).includes(value);
}

/**
 * Hydrate the form value from config. Keys are normalised; entries with a blank
 * key or a value outside the mappable set are dropped, as the backend reader
 * drops them, so the form never shows a mapping the server would not apply.
 */
export function readPaymentMethodMapForm(
  config: Record<string, unknown> | null | undefined,
): Record<string, PaymentMethodChoice> {
  const raw = config?.[PAYMENT_METHOD_MAP_CONFIG_KEY];
  const out: Record<string, PaymentMethodChoice> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizePaymentMethodKey(key);
    if (normalized !== '' && isMappablePaymentMethod(value)) {
      out[normalized] = value;
    }
  }
  return out;
}
