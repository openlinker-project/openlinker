/**
 * Fiscalization Port
 *
 * Capability contract for handing a completed sale to a provider that performs
 * or brokers its fiscal registration (ADR-042). Resolved per connection through
 * the integrations registry under the capability `'Fiscalization'`, exactly like
 * every other capability port.
 *
 * The base port carries ONE transaction operation and nothing else (ADR-042
 * decision 2). Two published middleware contracts converged on that single
 * operation, so it is adopted rather than invented. Everything a regime adds -
 * a device dependency, a periodic audit export - is an ADR-002 sub-capability,
 * never a method here that most providers would have to no-op.
 *
 * The adapter is a PURE MECHANISM. It never deduplicates: persistence and the
 * exactly-once guarantee are owned by the core service, because a double fiscal
 * registration is a legal event for the seller rather than a data-quality issue.
 *
 * OpenLinker is never the issuer. It feeds a registering mechanism and records
 * what came back.
 *
 * @module libs/core/src/fiscalization/domain/ports
 * @see {@link FiscalRegistrationLocator} for the indeterminate-outcome lookup seam
 */
import type {
  RegisterTransactionCommand,
  RegisterTransactionResult,
} from '../types/fiscalization.types';

export interface FiscalizationPort {
  /**
   * Register one completed sale.
   *
   * Returns what identifies the registration plus whatever customer-facing
   * artefacts it produced - a POSSIBLY EMPTY list, where empty is a success.
   *
   * A business rejection where the provider definitely created nothing SHOULD be
   * thrown carrying a neutral `failureMode: 'rejected'`; anything the core
   * service cannot read as `rejected` is treated as the fiscal-safe `in-doubt`
   * and is never auto-retried.
   */
  registerTransaction(cmd: RegisterTransactionCommand): Promise<RegisterTransactionResult>;
}
