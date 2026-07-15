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
import type { NbpExchangeRateResolverPort } from '../fx/nbp-exchange-rate.types';

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
  /** Injected clock so the adapter (and its FA(3) timestamps) stay testable. */
  now?: () => Date;
  /**
   * NBP exchange-rate resolver (#1581) for the art. 106e ust. 11 PLN/VAT
   * conversion of foreign-currency invoices. Injected so specs can fake it;
   * the factory always wires the concrete {@link NbpExchangeRateClient}. When
   * absent (bare unit specs), foreign-currency conversion is skipped with a
   * warning and PLN invoices are unaffected either way.
   */
  exchangeRateResolver?: NbpExchangeRateResolverPort;
  /**
   * Interim cross-border escape hatch (#1586). When `true`, issuance skips the
   * `assertCrossBorderHandled` guard and issues even when the buyer country
   * differs from the seller country (the operator asserts they have handled tax
   * banding out of band). Defaults to `false` - cross-border sales are refused
   * with `KsefCrossBorderUnsupportedException` rather than emitting a
   * silently-wrong domestic-rate document. Resolved by the factory from
   * `KsefConnectionConfig.allowCrossBorder`.
   */
  allowCrossBorder?: boolean;
}
