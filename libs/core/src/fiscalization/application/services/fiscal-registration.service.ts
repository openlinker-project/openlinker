/**
 * Fiscal Registration Service
 *
 * Core application service that orchestrates fiscal registration (ADR-042). A
 * DUMB executor: it owns idempotency, the persist-intent-before-call lifecycle
 * and per-connection adapter resolution. It does NOT decide whether an order
 * legally requires a fiscal registration - the seller and their accountant own
 * that determination, and nothing here is registered unless a caller asks
 * (ADR-042 decision 9).
 *
 * Depends only on ports (`FiscalRegistrationRecordRepositoryPort` +
 * `IIntegrationsService`), never on a concrete adapter; nothing from
 * `libs/integrations` is imported, and no country, regime or vendor vocabulary
 * lives here.
 *
 * @module libs/core/src/fiscalization/application/services
 * @implements {IFiscalRegistrationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';

import type {
  FiscalReconcileResult,
  IFiscalRegistrationService,
} from './fiscal-registration.service.interface';
import type { FiscalRegistrationRecord } from '../../domain/entities/fiscal-registration-record.entity';
import { FiscalRegistrationRecordRepositoryPort } from '../../domain/ports/fiscal-registration-record-repository.port';
import type { FiscalizationPort } from '../../domain/ports/fiscalization.port';
import { isFiscalRegistrationLocator } from '../../domain/ports/capabilities/fiscal-registration-locator.capability';
import { DuplicateFiscalRegistrationRecordException } from '../../domain/exceptions/duplicate-fiscal-registration-record.exception';
import { FiscalRegistrationNotInDoubtException } from '../../domain/exceptions/fiscal-registration-not-in-doubt.exception';
import { FiscalRegistrationRecordNotFoundException } from '../../domain/exceptions/fiscal-registration-record-not-found.exception';
import { MissingIdempotencyKeyException } from '../../domain/exceptions/missing-idempotency-key.exception';
import { MissingFiscalTaxRateException } from '../../domain/exceptions/missing-tax-rate.exception';
import { isTaxRateStrictEnabled } from '@openlinker/core/sales-documents';
import { OrderAlreadyRegisteredException } from '../../domain/exceptions/order-already-registered.exception';
import { FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN } from '../../fiscalization.tokens';
import type {
  FiscalRegistrationFailureMode,
  FiscalRegistrationOutcomePatch,
  RegisterTransactionCommand,
} from '../../domain/types/fiscalization.types';

/**
 * Capability key the connection must declare. Registered in the CLOSED
 * `CoreCapabilityValues` (ADR-042 decision 1) rather than riding the open-world
 * string escape, because the connection DTOs validate `enabledCapabilities`
 * against that list.
 */
const FISCALIZATION_CAPABILITY = 'Fiscalization';

/** Max persisted length of the INTERNAL-ONLY sanitized diagnostic. */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/** Max persisted length of the PII-free, operator-facing failure summary. */
const MAX_FAILURE_REASON_LENGTH = 200;

/**
 * Lifetime of an in-flight registration claim. Bounds how long a crashed
 * mid-call attempt blocks same-key retries before the slot becomes re-claimable.
 *
 * FISCAL SAFETY - this MUST stay strictly greater than the longest possible
 * single provider round-trip, or an expired lease could be re-claimed while the
 * original call is still in flight, producing a SECOND registration of one sale.
 * The margin is enforced BY CONSTRUCTION below rather than by comment.
 *
 * @internal Exported only so the invariant is unit-testable.
 */
export const REGISTERING_LEASE_MS = 5 * 60 * 1000;

/**
 * Hard ceiling on any single provider round-trip. {@link REGISTERING_LEASE_MS}
 * must strictly exceed it.
 *
 * ENFORCED HERE, not asserted about adapters: `registerWithAdapter` races the
 * adapter call against this bound, so no adapter can exceed it whatever its own
 * transport does. That is what makes the lease margin true rather than a
 * convention - invoicing's identically-worded constant is true only because ONE
 * adapter happens to validate its `timeoutMs` at config time, which says nothing
 * about the next one.
 *
 * The bound alone would not be enough: a raced-out promise is NOT cancelled, so
 * the underlying request may still land. That is why a timeout is classified
 * `in-doubt` (never `rejected`) and an `in-doubt` row is not claimable - the
 * expired-lease disjunct of `claimForRegistration` can therefore only be reached
 * after the owning PROCESS died, and never while a call this process started is
 * still open.
 *
 * A dead process does NOT prove the request never landed, though: the socket
 * dying with the process says nothing about whether the provider had already
 * processed it. So re-claiming an expired-lease row IS a resend of a possibly-
 * already-registered sale - a case core's own exactly-once guarantee does not
 * close by itself (ADR-042 decision 6 accepts this: the base `FiscalizationPort`
 * contract requires a caller-supplied idempotency key precisely so a provider
 * can dedupe a resend it cannot otherwise distinguish from a new sale). Core
 * still refuses to invent a fiscal outcome it cannot observe, but the crash
 * window between "process died" and "request may have landed" is real and is
 * closed by the adapter's own vendor-side idempotency key, not by this lease.
 *
 * @internal Exported for the unit tests that pin both halves of the invariant.
 */
export const MAX_SUPPORTED_PROVIDER_TIMEOUT_MS = 120 * 1000;

// Fail loud at module load if anyone lowers the lease below the supported
// provider-timeout ceiling, which would reopen the double-registration race the
// lease exists to close.
if (REGISTERING_LEASE_MS <= MAX_SUPPORTED_PROVIDER_TIMEOUT_MS) {
  throw new Error(
    `Fiscal-safety invariant violated: REGISTERING_LEASE_MS (${REGISTERING_LEASE_MS}ms) must strictly ` +
      `exceed MAX_SUPPORTED_PROVIDER_TIMEOUT_MS (${MAX_SUPPORTED_PROVIDER_TIMEOUT_MS}ms) so an expired ` +
      `lease can never be re-claimed mid-flight and register one sale twice.`,
  );
}

/**
 * Thrown when the provider call outruns {@link MAX_SUPPORTED_PROVIDER_TIMEOUT_MS}.
 *
 * Carries NO `failureMode`, so `classifyFailure` reads it as the fiscal-safe
 * `in-doubt`: giving up on the promise does not cancel the request, so the sale
 * may well be registered.
 */
class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The fiscalization provider did not answer within ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
  }
}

/**
 * Neutral shape read STRUCTURALLY off a caught adapter throwable to classify the
 * failure. NOT an adapter error subclass and NOT value-imported - core never
 * depends on an integration package's error types.
 */
interface NeutralFailureCarrier {
  failureMode?: unknown;
  /** Operator-readable rejection reason some adapters stamp on a terminal throw. */
  reason?: unknown;
}

@Injectable()
export class FiscalRegistrationService implements IFiscalRegistrationService {
  private readonly logger = new Logger(FiscalRegistrationService.name);

  constructor(
    @Inject(FISCAL_REGISTRATION_RECORD_REPOSITORY_TOKEN)
    private readonly repo: FiscalRegistrationRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async register(cmd: RegisterTransactionCommand): Promise<FiscalRegistrationRecord> {
    const key = cmd.idempotencyKey?.trim() ?? '';
    if (key.length === 0) {
      // Not a validation nicety: without a key there is no exactly-once
      // guarantee at all, and a sale registered twice is a legal event for the
      // seller. Refuse rather than degrade.
      throw new MissingIdempotencyKeyException(cmd.orderId);
    }

    // Everything downstream - the read gate, the persisted row, the reconcile
    // lookup AND the adapter - must see the SAME key, or a provider that echoes
    // OL's key back would be queried later under a value it never received.
    const normalized: RegisterTransactionCommand = { ...cmd, idempotencyKey: key };

    // #2252 (ADR-052 § 6): a line with no tax rate is refused BEFORE the read
    // gate and before any row is written - the same rule as the invoice, and
    // for the same reason. A provider filling the gap from the connection's
    // configured tax letter puts an unconfirmed rate on a real fiscal receipt,
    // which reaches the buyer and the daily report and cannot be recalled.
    //
    // The accepted cost is LATE registration, chosen deliberately: a late
    // registration can be completed, a wrong one has to be corrected. Placed
    // ahead of the read gate so a held sale leaves no `pending` row behind to
    // reconcile.
    //
    // THIS CALL IS THE REVERSAL POINT. Nothing else in this context consults
    // the rate, so removing this one line restores the pre-#2252 behaviour -
    // and switching `OL_TAX_RATE_STRICT_ENABLED` off does the same without a
    // deploy (#2245 review), which is what keeps day one from being an outage
    // while catalogue coverage is still zero.
    this.assertEveryLineHasATaxRate(normalized);

    // (1) Read gate. An existing row is RESUMED under the fiscal-safety
    // invariant - never returned blindly and never re-sent blindly.
    const existing = await this.repo.findByIdempotencyKey(normalized.connectionId, key);
    if (existing) {
      return this.resumeExisting(normalized, existing);
    }

    // (2) No same-key row exists, so this asks for a NEW originating
    // registration of the sale. Refuse if the order already has one; the unique
    // index cannot see this, because it is keyed on
    // `(connectionId, idempotencyKey)` and knows nothing about orders.
    await this.assertNotAlreadyRegistered(normalized.orderId, normalized.connectionId);

    // (3) Persist intent BEFORE any outbound call, so an indeterminate crash
    // leaves durable evidence to reconcile against. ADR-005's
    // delete-the-row-on-failure step is deliberately NOT adopted here: deleting
    // on a throw is the blind-resend path, and the row IS the in-doubt evidence.
    let pending: FiscalRegistrationRecord;
    try {
      pending = await this.repo.create({
        connectionId: normalized.connectionId,
        orderId: normalized.orderId,
        // The adapter owns the authoritative provider identity; the success
        // patch backfills it. The pending row records '' until then.
        providerType: '',
        idempotencyKey: key,
        status: 'pending',
      });
    } catch (error) {
      // (3a) Create-race: a concurrent same-key call won the unique guard
      // between our read gate and this create. Re-read the winner and resume it
      // under the SAME invariant, so both callers agree about the same state.
      if (error instanceof DuplicateFiscalRegistrationRecordException) {
        const winner = await this.repo.findByIdempotencyKey(normalized.connectionId, key);
        if (winner) {
          return this.resumeExisting(normalized, winner);
        }
      }
      throw error;
    }

    return this.registerWithAdapter(normalized, pending.id);
  }

  async getByOrderId(orderId: string): Promise<FiscalRegistrationRecord[]> {
    return this.repo.findAllByOrderId(orderId);
  }

  async getById(id: string): Promise<FiscalRegistrationRecord> {
    const record = await this.repo.findById(id);
    if (!record) {
      throw new FiscalRegistrationRecordNotFoundException(id);
    }
    return record;
  }

  async reconcileInDoubt(recordId: string): Promise<FiscalReconcileResult> {
    const record = await this.getById(recordId);
    if (!record.isInDoubt) {
      throw new FiscalRegistrationNotInDoubtException(recordId, record.status);
    }

    const adapter = await this.integrations.getCapabilityAdapter<FiscalizationPort>(
      record.connectionId,
      FISCALIZATION_CAPABILITY,
    );

    // Advertised-without-dispatch narrowing (ADR-002): the sub-capability is
    // resolved by narrowing the DISPATCHED adapter, never asked for by name from
    // the registry.
    if (!isFiscalRegistrationLocator(adapter)) {
      this.logger.warn(
        `Connection ${record.connectionId} cannot be queried by business coordinates; ` +
          `fiscal registration record ${recordId} stays in doubt for operator handling`,
      );
      return { outcome: 'unsupported', record };
    }

    const located = await adapter.locateByQuery({
      idempotencyKey: record.idempotencyKey,
      orderId: record.orderId,
    });

    if (located === null) {
      // Evidence, not authority. The provider reporting no match does NOT
      // license a resend from here: the record stays in doubt and an operator
      // decides. Re-attempting is only ever reached through `register` under the
      // claim predicate, which refuses an in-doubt row outright.
      this.logger.warn(
        `Provider on connection ${record.connectionId} holds no registration matching ` +
          `record ${recordId}; leaving it in doubt for an operator decision`,
      );
      return { outcome: 'not-found', record };
    }

    const locatedProviderType = located.providerType?.trim() ?? '';
    const patch: FiscalRegistrationOutcomePatch = {
      status: 'registered',
      // Present-only: an omitted key is never read as "set to null", so an
      // adapter that reports no identity leaves whatever the record holds rather
      // than having core invent one.
      ...(locatedProviderType.length > 0 ? { providerType: locatedProviderType } : {}),
      providerReference: located.providerReference,
      documentReference: located.documentReference,
      signingIdentity: located.signingIdentity,
      registeredAt: located.registeredAt,
      regimeExtras: located.regimeExtras ?? null,
      artefacts: located.artefacts ?? null,
      // The doubt is settled: clear the failure and release any stale lease.
      failureMode: null,
      failureReason: null,
      errorMessage: null,
      leaseExpiresAt: null,
    };
    const resolved = await this.repo.updateOutcome(recordId, patch);
    return { outcome: 'resolved', record: resolved };
  }

  /**
   * At-most-one-originating-registration guard.
   *
   * The exactly-once index is `(connectionId, idempotencyKey)`; it has no notion
   * of an ORDER, so on its own "register order O, then register order O again
   * under any other key" passes every per-key invariant and registers one sale
   * twice. ADR-042 decision 6 puts the guarantee in the contract because that
   * outcome is a legal event for the seller, so the second attempt is REFUSED.
   *
   * Blocking is `FiscalRegistrationRecord.blocksFurtherRegistration` - the same
   * predicate ADR-041 §3b states for originating documents, so an order cannot
   * be told "already documented" by one context and "free" by the other. Only a
   * terminal `rejected` record (the provider definitely created nothing) leaves
   * the sale registrable again.
   *
   * Scope differences from invoicing's `assertNotInvoicedElsewhere` (#2047), both
   * deliberate:
   *   - records on the REQUESTED connection are NOT skipped. That is the whole
   *     point: a second key on the same connection is the interleaving the index
   *     cannot see. Skipping it here would be safe there only because the read
   *     gate already returned - which it did, or this method would not run.
   *   - no `SyncLockPort` is taken. This is a read, so it is read-then-act:
   *     two SIMULTANEOUS attempts on two DIFFERENT connections for a
   *     never-registered order can both observe nothing and both proceed. The
   *     same-connection case (the only one the shipped HTTP surface can produce,
   *     since it mints one deterministic key per (connection, order)) is closed
   *     by the unique index instead. Narrowing that last window means adopting
   *     the per-order `SyncLockPort` invoicing takes around the same check
   *     (`invoiceIssueLockKey`); deliberately not done here, so the residual
   *     window is: two fiscalization connections, one never-registered order,
   *     two truly simultaneous operator requests.
   */
  private async assertNotAlreadyRegistered(
    orderId: string,
    requestedConnectionId: string,
  ): Promise<void> {
    const records = await this.repo.findAllByOrderId(orderId);
    const blocking = records.find((record) => record.blocksFurtherRegistration);
    if (!blocking) {
      return;
    }

    // `warn`, not `error`: a refusal here is the guard WORKING, and it is raised
    // to the caller as a 409 rather than left in a log.
    this.logger.warn(
      `Refusing a second fiscal registration of order ${orderId} on connection ` +
        `${requestedConnectionId}: record ${blocking.id} on connection ` +
        `${blocking.connectionId} is ${blocking.status}` +
        `${blocking.status === 'failed' ? ` (failureMode=${blocking.failureMode ?? 'unknown'})` : ''}`,
    );
    throw new OrderAlreadyRegisteredException(
      orderId,
      blocking.connectionId,
      requestedConnectionId,
      blocking.status,
      blocking.id,
    );
  }

  /**
   * Decide how to resume an EXISTING same-key record, enforcing the
   * fiscal-safety invariant before anything re-crosses the provider boundary.
   * Shared by the read gate and the create-race re-read so both honour the same
   * rules.
   */
  private async resumeExisting(
    cmd: RegisterTransactionCommand,
    existing: FiscalRegistrationRecord,
  ): Promise<FiscalRegistrationRecord> {
    if (existing.isRegistered) {
      // A completed fiscal registration cannot be un-done. Idempotent replay.
      return existing;
    }

    if (existing.isLeaseLive(new Date())) {
      this.logger.warn(
        `Fiscal registration record ${existing.id} is claimed by a live in-flight attempt; ` +
          `not re-attempting`,
      );
      return existing;
    }

    if (existing.status === 'failed' && !existing.isReattemptableFailure) {
      this.logger.warn(
        `Fiscal registration record ${existing.id} failed in doubt ` +
          `(failureMode=${existing.failureMode ?? 'unknown'}); not auto-re-attempting - ` +
          `surfaced for reconciliation`,
      );
      return existing;
    }

    // Re-attemptable: `pending`, an expired lease, or a terminal `rejected`
    // failure. The claim below decides which single attempt proceeds.
    return this.registerWithAdapter(cmd, existing.id);
  }

  /**
   * Refuse a sale whose lines do not all name a tax rate (#2252).
   *
   * `'0'` passes - a zero rate is an answer, and refusing it would hold every
   * deliberately exempt sale. A blank one does not: that is what core emits
   * when nothing established the rate, and it is exactly the value each
   * provider would silently replace with its own default.
   */
  private assertEveryLineHasATaxRate(cmd: RegisterTransactionCommand): void {
    // #2245 review: off unless the deployment opted in. A receipt path has no
    // order era to consult - `RegisterTransactionCommand` carries none - so the
    // switch is the only gate here; see the report on #2260 for why the era
    // exemption stops at the two invoice sites.
    if (!isTaxRateStrictEnabled()) return;
    const missing = cmd.lines.filter((line) => line.taxRate.trim() === '');
    if (missing.length === 0) return;
    throw new MissingFiscalTaxRateException(
      cmd.orderId,
      missing.length,
      cmd.lines.length,
      missing[0]?.sku ?? missing[0]?.name ?? null,
    );
  }

  /**
   * Resolve the per-connection adapter, claim the in-flight slot atomically,
   * cross the CORE <-> Integration boundary and patch the record with the
   * outcome.
   *
   * The claim is the single-flight guard: a concurrent same-key attempt that
   * fails to claim backs off WITHOUT calling the provider.
   *
   * ADAPTER RESOLUTION COMES FIRST, and that ordering is load-bearing. Claiming
   * first means a connection with the capability disabled - the single most
   * likely first-run misconfiguration - parks the row `registering` under a live
   * lease with no `failureMode` and no `failureReason`, so for the whole lease
   * window a retry reports "an attempt is in progress" for a call that was never
   * made, and no surface can explain the row. Resolving first leaves the record
   * untouched (`pending`, no lease, freely re-attemptable) and lets the
   * configuration fault surface as itself. This DIVERGES from
   * `InvoiceService.issueWithAdapter`, which still claims first; the same fix
   * belongs there, but inheriting a known stuck state is not a reason to ship
   * one on a new surface.
   */

  private async registerWithAdapter(
    cmd: RegisterTransactionCommand,
    recordId: string,
  ): Promise<FiscalRegistrationRecord> {
    const adapter = await this.integrations.getCapabilityAdapter<FiscalizationPort>(
      cmd.connectionId,
      FISCALIZATION_CAPABILITY,
    );

    const leaseExpiresAt = new Date(Date.now() + REGISTERING_LEASE_MS);
    const claimed = await this.repo.claimForRegistration(recordId, leaseExpiresAt);
    if (claimed === null) {
      this.logger.warn(
        `Could not claim fiscal registration record ${recordId} ` +
          `(held by a live attempt, already registered, or in doubt); not re-attempting`,
      );
      const current = await this.repo.findById(recordId);
      if (current) {
        return current;
      }
      throw new FiscalRegistrationRecordNotFoundException(recordId);
    }

    let result: Awaited<ReturnType<FiscalizationPort['registerTransaction']>>;
    try {
      result = await this.callWithinSupportedTimeout(() => adapter.registerTransaction(cmd));
    } catch (error) {
      const failureMode = this.classifyFailure(error);
      const patch: FiscalRegistrationOutcomePatch = {
        status: 'failed',
        failureMode,
        failureReason: this.deriveFailureReason(error, failureMode),
        errorMessage: this.sanitizeError(error),
        // The attempt is over either way; release the lease. The ROW is what
        // carries the in-doubt evidence forward - it is never deleted.
        leaseExpiresAt: null,
      };
      this.logger.warn(
        `Fiscal registration failed for record ${recordId} (failureMode=${failureMode})`,
      );
      // Deliberately does NOT rethrow (unlike the invoicing sibling): an
      // indeterminate outcome must be VISIBLY indeterminate to the caller, and
      // the caller needs the record id to reconcile against. A failure surfaces
      // on the order with an actionable reason instead of interrupting the
      // caller's other work.
      return this.repo.updateOutcome(recordId, patch);
    }

    const patch: FiscalRegistrationOutcomePatch = {
      status: 'registered',
      providerType: result.providerType,
      providerReference: result.providerReference,
      documentReference: result.documentReference,
      signingIdentity: result.signingIdentity,
      registeredAt: result.registeredAt,
      regimeExtras: result.regimeExtras ?? null,
      // An EMPTY artefact list is a success, not a failure: a pure reporting
      // regime returns identifiers only. It is persisted as `[]`, distinct from
      // the `null` of a row that never got that far.
      artefacts: result.artefacts,
      failureMode: null,
      failureReason: null,
      errorMessage: null,
      leaseExpiresAt: null,
    };
    return this.repo.updateOutcome(recordId, patch);
  }

  /**
   * Run one provider call under the {@link MAX_SUPPORTED_PROVIDER_TIMEOUT_MS}
   * ceiling, so the lease margin holds for EVERY adapter rather than for the
   * ones that happen to bound themselves.
   *
   * Two details are not incidental:
   *   - the loser of the race is swallowed with a no-op `catch`. A `Promise.race`
   *     leaves the slower promise live, and an unhandled rejection from a call
   *     nobody is waiting for would crash the process on Node's default policy.
   *   - the timeout error carries no `failureMode`, so it classifies as
   *     `in-doubt`. Racing does NOT cancel the request: the sale may still be
   *     registered, and an `in-doubt` row is never re-claimable, which is exactly
   *     what keeps the expired-lease disjunct from licensing a second call.
   */
  private async callWithinSupportedTimeout<T>(call: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inFlight = call();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new ProviderTimeoutError(MAX_SUPPORTED_PROVIDER_TIMEOUT_MS)),
        MAX_SUPPORTED_PROVIDER_TIMEOUT_MS,
      );
    });

    inFlight.catch(() => undefined);

    try {
      return await Promise.race([inFlight, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Read the neutral failure mode STRUCTURALLY off the caught throwable.
   * Anything not readable as the terminal `'rejected'` is treated as
   * `'in-doubt'` - the fiscal-safe default, because the alternative default
   * would license a resend of a sale that may already be registered.
   */
  private classifyFailure(error: unknown): FiscalRegistrationFailureMode {
    const mode = (error as NeutralFailureCarrier | null)?.failureMode;
    return mode === 'rejected' ? 'rejected' : 'in-doubt';
  }

  /**
   * Derive the short, PII-free, operator-facing summary. For a terminal
   * rejection an adapter may stamp a neutral `reason`; anything else gets a
   * fixed sentence, because an indeterminate outcome has no provider-supplied
   * explanation by definition.
   */
  private deriveFailureReason(
    error: unknown,
    failureMode: FiscalRegistrationFailureMode,
  ): string {
    if (failureMode === 'in-doubt') {
      return 'The provider did not confirm the registration; it may or may not have been registered. Reconcile before retrying.';
    }
    const reason = (error as NeutralFailureCarrier | null)?.reason;
    const text = typeof reason === 'string' ? reason.trim() : '';
    return (text.length > 0 ? text : 'The provider rejected the registration.').slice(
      0,
      MAX_FAILURE_REASON_LENGTH,
    );
  }

  /**
   * Bound the INTERNAL-ONLY diagnostic before storing it. An adapter is
   * third-party-shaped and may echo buyer-supplied data in a message, so this
   * stays a small operator diagnostic rather than an unbounded PII sink, and is
   * never returned to an API caller.
   */
  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  }
}
