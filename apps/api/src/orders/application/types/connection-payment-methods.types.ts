/**
 * Connection payment-methods view types (#3774)
 *
 * @module apps/api/src/orders/application/types
 */
import type { PaymentMethod, PaymentMethodResolution } from '@openlinker/core/orders';

/**
 * Whether the connection's integration honours the operator's map.
 * `unknown` means the connection could not be asked (disabled, credentials,
 * adapter failure) - never read as `unsupported`.
 */
export const PaymentMethodMapSupportValues = ['supported', 'unsupported', 'unknown'] as const;
export type PaymentMethodMapSupport = (typeof PaymentMethodMapSupportValues)[number];

export interface ObservedPaymentMethodItem {
  readonly sourcePaymentMethod: string;
  readonly orderCount: number;
  readonly lastSeenAt: Date;
  /** What the platform itself says; null unless `mapSupport` is `supported`. */
  readonly platformMethod: PaymentMethod | null;
  /** What the operator's map says; null unless supported and mapped. */
  readonly operatorMethod: PaymentMethod | null;
  readonly resolvedMethod: PaymentMethod | null;
  readonly resolvedBy: PaymentMethodResolution | null;
}

export interface ConnectionPaymentMethodsView {
  readonly mapSupport: PaymentMethodMapSupport;
  readonly windowDays: number;
  readonly items: readonly ObservedPaymentMethodItem[];
}
