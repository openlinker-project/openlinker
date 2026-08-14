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
 * Hard ceiling on any single provider round-trip the system supports (including
 * transport retries). {@link REGISTERING_LEASE_MS} must strictly exceed it.
 *
 * @internal Exported only for the unit test that pins the invariant.
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

    // (1) Read gate. An existing row is RESUMED under the fiscal-safety
    // invariant - never returned blindly and never re-sent blindly.
    const existing = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
    if (existing) {
      return this.resumeExisting(cmd, existing);
    }

    // (2) Persist intent BEFORE any outbound call, so an indeterminate crash
    // leaves durable evidence to reconcile against. ADR-005's
    // delete-the-row-on-failure step is deliberately NOT adopted here: deleting
    // on a throw is the blind-resend path, and the row IS the in-doubt evidence.
    let pending: FiscalRegistrationRecord;
    try {
      pending = await this.repo.create({
        connectionId: cmd.connectionId,
        orderId: cmd.orderId,
        // The adapter owns the authoritative provider identity; the success
        // patch backfills it. The pending row records '' until then.
        providerType: '',
        idempotencyKey: key,
        status: 'pending',
      });
    } catch (error) {
      // (2a) Create-race: a concurrent same-key call won the unique guard
      // between our read gate and this create. Re-read the winner and resume it
      // under the SAME invariant, so both callers agree about the same state.
      if (error instanceof DuplicateFiscalRegistrationRecordException) {
        const winner = await this.repo.findByIdempotencyKey(cmd.connectionId, key);
        if (winner) {
          return this.resumeExisting(cmd, winner);
        }
      }
      throw error;
    }

    return this.registerWithAdapter(cmd, pending.id);
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

    const patch: FiscalRegistrationOutcomePatch = {
      status: 'registered',
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
   * Claim the in-flight slot atomically, resolve the per-connection adapter,
   * cross the CORE <-> Integration boundary and patch the record with the
   * outcome.
   *
   * The claim is the single-flight guard: a concurrent same-key attempt that
   * fails to claim backs off WITHOUT calling the provider.
   */
  private async registerWithAdapter(
    cmd: RegisterTransactionCommand,
    recordId: string,
  ): Promise<FiscalRegistrationRecord> {
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

    const adapter = await this.integrations.getCapabilityAdapter<FiscalizationPort>(
      cmd.connectionId,
      FISCALIZATION_CAPABILITY,
    );

    let result: Awaited<ReturnType<FiscalizationPort['registerTransaction']>>;
    try {
      result = await adapter.registerTransaction(cmd);
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
