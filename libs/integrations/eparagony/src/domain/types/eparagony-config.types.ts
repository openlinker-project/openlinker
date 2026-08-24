/**
 * eparagony.pl Connection Config Types
 *
 * Shape of the non-secret `Connection.config` JSONB blob for an eparagony.pl
 * connection. Validated at save time by
 * `EparagonyConnectionConfigShapeValidatorAdapter` so a malformed connection is
 * rejected with a 400 rather than surfacing as an opaque vendor rejection at
 * registration time.
 *
 * @module libs/integrations/eparagony/src/domain/types
 */

/** Which vendor deployment a connection talks to. */
export const EparagonyEnvironmentValues = ['sandbox', 'production'] as const;
export type EparagonyEnvironment = (typeof EparagonyEnvironmentValues)[number];

/**
 * The seven fiscal rate slots a Polish fiscal device exposes. A receipt line
 * carries the LETTER; the merchant-level table below says what each letter
 * currently means. Both are vendor-mandatory on every document.
 */
export const EparagonyTaxRateCodeValues = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export type EparagonyTaxRateCode = (typeof EparagonyTaxRateCodeValues)[number];

/** Letter -> rate string, exactly as the vendor's `metadata.taxRates` expects. */
export type EparagonyTaxRateTable = Record<EparagonyTaxRateCode, string>;

/**
 * Payment forms the vendor accepts on `payment.payments[].paymentForm`. Vendor
 * vocabulary, verbatim - a fiscal printer only understands these labels, so
 * translating them would break the write.
 */
export const EparagonyPaymentFormValues = [
  'Gotowka',
  'Karta',
  'Czek',
  'Bon',
  'Inna',
  'Kredyt',
  'Waluta obca',
  'Przelew',
  'Mobilna',
  'Voucher',
] as const;
export type EparagonyPaymentForm = (typeof EparagonyPaymentFormValues)[number];

/**
 * The vendor spells two of its payment forms with Polish diacritics. The union
 * above is ASCII so it is safe to type and compare; this map restores the wire
 * spelling on the way out. Any form not listed is already wire-identical.
 */
export const EPARAGONY_PAYMENT_FORM_WIRE: Partial<Record<EparagonyPaymentForm, string>> = {
  Gotowka: 'Gotówka',
};

export interface EparagonyConnectionConfig {
  /** Which vendor deployment to talk to. Selects both the API and the OAuth host. */
  environment: EparagonyEnvironment;

  /**
   * Vendor-assigned store / register identifier, stamped on every document.
   * Mandatory on `POST /documents`; a wrong value surfaces as `errorCode: 43`.
   */
  posId: string;

  /**
   * Letter -> rate table sent as `metadata.taxRates`. Defaults to the current
   * Polish standard slots when absent. It describes the SELLER's device
   * configuration, so an operator whose device is programmed differently must
   * override it - OL cannot observe the device.
   */
  taxRates?: Partial<EparagonyTaxRateTable>;

  /**
   * The connection's own device slot, declared by the operator.
   *
   * **It is no longer a fallback for an unknown rate (#2252, ADR-063).** Core
   * now refuses to hand over a sale whose lines do not all name a rate, so a
   * line reaches this adapter with an empty `taxRate` only if that gate is
   * removed. The setting is kept, and still supported, because it describes the
   * seller's device rather than a rate OpenLinker invented - but it must never
   * be presented to an operator as "what we use when we do not know". A receipt
   * carrying an unconfirmed rate reaches the buyer and the daily report and
   * cannot be recalled; that is the trade this setting used to make silently.
   *
   * Absent still means an un-rated line blocks, which is now the same answer
   * core gives one step earlier.
   */
  defaultTaxRateCode?: EparagonyTaxRateCode;

  /**
   * Ask the vendor's print service to also produce a paper receipt. Defaults to
   * `false`: an e-commerce sale registered asynchronously has no counter and no
   * customer standing at one.
   */
  print?: boolean;

  /**
   * Payment form declared on the receipt. Defaults to `Przelew` (bank transfer),
   * the honest description of a prepaid e-commerce order. The vendor rejects a
   * document whose declared payment does not equal the sale value
   * (`errorCode: 87`), so the AMOUNT is always the sale total - only the label
   * is configurable.
   */
  paymentForm?: EparagonyPaymentForm;

  /** Free-text payment name (card scheme, PSP). Optional; purely descriptive. */
  paymentName?: string;

  /**
   * How long to wait for the device to reach a terminal status before giving up
   * and reporting the outcome as in-doubt. Clamped by the adapter so the whole
   * call stays inside core's supported provider round-trip ceiling.
   */
  statusPollTimeoutMs?: number;

  /**
   * DIAGNOSTIC ONLY - the unique number of the fiscal device this connection
   * feeds, used by "Test connection" to also report whether the device has been
   * seen alive recently.
   *
   * It is never sent on a document: the vendor routes to the device itself, and
   * the device's number comes BACK on the confirmed status. Optional, because a
   * freshly configured connection legitimately does not know it yet.
   */
  fiscalDeviceUniqueNumber?: string;

  /** Override for the API host. Must be https. Intended for testing. */
  apiBaseUrl?: string;

  /** Override for the OAuth host. Must be https. Intended for testing. */
  authBaseUrl?: string;
}
