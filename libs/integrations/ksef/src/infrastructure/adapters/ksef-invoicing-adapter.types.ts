/**
 * KSeF Invoicing Adapter Types
 *
 * Optional-dependency bag for `KsefInvoicingAdapter`. Grouping the trailing
 * optional constructor inputs into one object keeps the positional parameter
 * list stable as new per-connection defaults are added (PR #1317 review — a
 * mid-list positional insert silently shifts later defaulted args at call
 * sites).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 * @see {@link KsefInvoicingAdapter}
 */
import type { Fa3PaymentInput } from '../fa3/domain/fa3-xml.types';

export interface KsefInvoicingAdapterOptions {
  /**
   * Resolved connection-level payment defaults (#1311) — omitted when the
   * connection has none configured, in which case the builder omits
   * `Platnosc` entirely.
   */
  payment?: Fa3PaymentInput;
  /**
   * Connection-level default unit of measure (#1525) applied to any line whose
   * neutral `unit` is absent - emitted as `FaWiersz/P_8A`. Omitted when the
   * connection has none configured, in which case unit-less lines omit `P_8A`.
   */
  defaultLineUnit?: string;
  /**
   * Connection-level fallback `P_12` neutral code applied to any line whose
   * neutral `taxRate` arrives empty (#1290/#1291), resolved by the factory from
   * `seller.defaultTaxRate` or the PL standard rate.
   *
   * Honoured ONLY while `OL_TAX_RATE_STRICT_ENABLED` is off (#2257, gated in the
   * #2245 review). With strict enforcement on, the adapter does not pass it and a
   * rate-less line raises `UnmappedTaxRateException` - core refuses such a
   * command first, so that is defence in depth.
   */
  defaultTaxRate?: string;
  /**
   * IANA timezone (#7) the numbering date variables + period-reset bucket resolve
   * in. Resolved from the connection config by the factory; `Europe/Warsaw` when
   * absent.
   */
  numberingTimeZone?: string;
  /** Injected clock so the adapter (and its FA(3) timestamps) stay testable. */
  now?: () => Date;
}
