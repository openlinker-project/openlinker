/**
 * Payment Writeback Connection Config (#3963)
 *
 * Per-destination-connection answer to "when the buyer pays after the order
 * reached this shop, what should OpenLinker do?". Stored on
 * `Connection.config.paymentWriteback` (JSONB, no migration), read through one
 * pure coercer - the `readStockSafetyBuffer` precedent.
 *
 * - `mode: 'mark-paid'` (the default) marks the shop order paid.
 * - `mode: 'leave'` sends nothing; the operator updates payment in the shop.
 * - `paidStateId` is the shop order state "paid" moves to, for a platform that
 *   models paid as a state (PrestaShop, Shoper). `null` lets the adapter pick
 *   its own default (the platform's first state flagged as paid).
 *
 * An absent or malformed value reads as the default, so every connection that
 * existed before #3963 marks orders paid without anyone opting in.
 *
 * @module libs/core/src/identifier-mapping/domain/types
 */
import type { ConnectionConfig } from './connection.types';

export const PAYMENT_WRITEBACK_CONFIG_KEY = 'paymentWriteback';

export const PaymentWritebackModeValues = ['mark-paid', 'leave'] as const;
export type PaymentWritebackConfigMode = (typeof PaymentWritebackModeValues)[number];

export interface PaymentWritebackConfig {
  mode: PaymentWritebackConfigMode;
  paidStateId: string | null;
}

export const DEFAULT_PAYMENT_WRITEBACK_CONFIG: PaymentWritebackConfig = Object.freeze({
  mode: 'mark-paid',
  paidStateId: null,
});

export function readPaymentWritebackConfig(
  config: ConnectionConfig | null | undefined
): PaymentWritebackConfig {
  const raw = config?.[PAYMENT_WRITEBACK_CONFIG_KEY];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PAYMENT_WRITEBACK_CONFIG;
  }
  const value = raw as Record<string, unknown>;
  const mode = (PaymentWritebackModeValues as readonly unknown[]).includes(value.mode)
    ? (value.mode as PaymentWritebackConfigMode)
    : DEFAULT_PAYMENT_WRITEBACK_CONFIG.mode;
  const paidStateId =
    typeof value.paidStateId === 'string' && value.paidStateId.trim() !== ''
      ? value.paidStateId.trim()
      : typeof value.paidStateId === 'number' && Number.isFinite(value.paidStateId)
        ? String(value.paidStateId)
        : null;
  return { mode, paidStateId };
}

/**
 * Write-path check: a present value the coercer would silently ignore. Used by
 * `ConnectionService` to refuse a malformed save instead of storing a setting
 * that reads back as something the operator did not choose.
 */
export function describeInvalidPaymentWritebackConfig(
  config: ConnectionConfig | null | undefined
): string | null {
  const raw = config?.[PAYMENT_WRITEBACK_CONFIG_KEY];
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return 'paymentWriteback must be an object';
  }
  const value = raw as Record<string, unknown>;
  if (!(PaymentWritebackModeValues as readonly unknown[]).includes(value.mode)) {
    return `paymentWriteback.mode must be one of: ${PaymentWritebackModeValues.join(', ')}`;
  }
  if (
    value.paidStateId != null &&
    !(typeof value.paidStateId === 'string' && value.paidStateId.trim() !== '') &&
    !(typeof value.paidStateId === 'number' && Number.isFinite(value.paidStateId))
  ) {
    return 'paymentWriteback.paidStateId must be a non-empty string, a number or null';
  }
  return null;
}
