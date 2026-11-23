/**
 * Refund Executor Capability (#2371, ADR-056)
 *
 * Ask a party to execute a refund. Originally the SOURCE channel only (the
 * buyer paid there, so only it can move their money), beside `ReturnSourceReader`
 * and `ReturnDecliner`. Since #4100 a DESTINATION order processor may also
 * implement it, solely to MIRROR a refund already paid on the source so the
 * destination's books agree; that is not the wrong ledger because it never moves
 * money OL owns (ADR-056 amendment). It is a guard-only sub-capability narrowed
 * off the dispatched adapter: for a destination, resolve 'OrderProcessorManager'.
 *
 * ## Source-side execution is implemented by nobody
 *
 * No SOURCE adapter implements this interface for returns-driven refunds. The seam ships ahead of its first implementer because
 * [ADR-056](../../../../../../docs/architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md)
 * requires the attempted-predicate ordering to be **restated, not inherited by
 * analogy** (R1) — the ordering that makes a double refund impossible has to
 * exist *before* a live money path runs through it, not be retrofitted onto one.
 * Until then `ReturnRefundService` confirms to
 * `executedBy: 'operator_out_of_band'`, an honest description of who moves money
 * today.
 *
 * ## UNDECLARED, not "advertised-without-dispatch"
 *
 * The neighbouring `ReturnDecliner` uses that phrase for a capability that IS
 * listed in an adapter manifest for host-side discovery. This one is not listed
 * anywhere, because there is nothing to advertise: no adapter supports it. The
 * applicable precedent is `ModifiedProductLister` (#2220) — guard-only, absent
 * from every manifest and from `CoreCapabilityValues`.
 *
 * When a source adapter does implement it, resolve it the way every sibling is
 * resolved: `getCapabilityAdapter<OrderSourcePort>(connectionId, 'OrderSource')`
 * then narrow with {@link isRefundExecutor}. For a destination mirror, resolve
 * `'OrderProcessorManager'` instead. Never
 * `getCapabilityAdapter(connectionId, 'RefundExecutor')` — such a call passes
 * the manifest gate and then fails inside `dispatchCapability` with a generic
 * `Error`, which in the list path aborts the whole listing instead of skipping
 * the connection.
 *
 * The guard is generic over the resolved adapter type (the `isReturnDecliner` /
 * `isReturnSourceReader` precedent) so a call site may narrow whatever object it
 * already resolved.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see docs/architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md
 */
import type {
  ExecuteRefundCommand,
  RefundExecutionResult,
} from '../../types/refund-execution.types';

export interface RefundExecutor {
  /**
   * Move the buyer's money, and report what happened.
   *
   * Three obligations on an implementer, each of which is a double refund or a
   * false claim if broken:
   *
   * 1. **Honour {@link ExecuteRefundCommand.idempotencyKey} and never mint your
   *    own.** Core recomputes an identical key on retry; an adapter-generated
   *    one turns a retry into a second refund.
   * 2. **`refundedAt` is the PLATFORM's instant or `null`** — never the
   *    adapter's clock. Core enters `refunded` only on an observation, and the
   *    operator reads that as *"Confirmed by {source}"*.
   * 3. **Throw for anything indeterminate; return `denied` only for a TERMINAL
   *    rejection.** Core treats every throw as *boundary crossed, outcome
   *    unobserved* and blocks further attempts; `denied` is the one answer that
   *    unblocks, so returning it for a timeout would authorise a second refund
   *    of money that may already have moved.
   *
   * An adapter SHOULD treat a platform "already refunded" response as a success
   * — re-reading to recover the real instant — rather than as a failure, for the
   * reason `ReturnDecliner.declineReturn` gives: the operator's intent is
   * satisfied, and an error would make a retry permanently red on a refund that
   * has in fact happened.
   */
  executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult>;
}

export function isRefundExecutor<T extends object>(adapter: T): adapter is T & RefundExecutor {
  const candidate = adapter as Partial<RefundExecutor>;
  return typeof candidate.executeRefund === 'function';
}
