/**
 * Observed source payment method (#3774)
 *
 * One row of the discovery read behind the operator's payment-method map: a
 * native payment identifier a connection's orders actually carried, with how
 * often and how recently. The identifier is grouped on its NORMALISED form
 * (`normalizeSourcePaymentMethodKey`), so `PayU` and `payu ` are one row.
 *
 * @module libs/core/src/orders/domain/types
 */
export interface ObservedSourcePaymentMethod {
  /** Normalised (trimmed, lower-cased) native identifier. */
  readonly sourcePaymentMethod: string;
  readonly orderCount: number;
  /** Placement instant of the newest order carrying it. */
  readonly lastSeenAt: Date;
}
