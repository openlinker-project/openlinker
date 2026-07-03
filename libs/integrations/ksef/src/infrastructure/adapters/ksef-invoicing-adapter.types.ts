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
  /** Injected clock so the adapter (and its FA(3) timestamps) stay testable. */
  now?: () => Date;
}
