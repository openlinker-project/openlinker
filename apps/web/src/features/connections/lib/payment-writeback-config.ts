/**
 * Payment writeback connection setting (#3963)
 *
 * Reads `config.paymentWriteback` into the edit-form shape. Mirrors the core
 * coercer `readPaymentWritebackConfig`: an absent or malformed value reads as
 * the default (mark the order paid, the shop's own default paid state), so a
 * connection created before #3963 shows the behaviour it actually gets.
 *
 * @module features/connections/lib
 */
export const PAYMENT_WRITEBACK_CONFIG_KEY = 'paymentWriteback';

export const PaymentWritebackModeValues = ['mark-paid', 'leave'] as const;
export type PaymentWritebackMode = (typeof PaymentWritebackModeValues)[number];

export interface PaymentWritebackFormValue {
  mode: PaymentWritebackMode;
  /** `''` means "the shop's own default paid state". */
  paidStateId: string;
}

export function readPaymentWritebackForm(
  config: Record<string, unknown> | null | undefined
): PaymentWritebackFormValue {
  const raw = config?.[PAYMENT_WRITEBACK_CONFIG_KEY];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { mode: 'mark-paid', paidStateId: '' };
  }
  const value = raw as Record<string, unknown>;
  const mode: PaymentWritebackMode = value.mode === 'leave' ? 'leave' : 'mark-paid';
  const paidStateId =
    typeof value.paidStateId === 'string'
      ? value.paidStateId
      : typeof value.paidStateId === 'number'
        ? String(value.paidStateId)
        : '';
  return { mode, paidStateId };
}
