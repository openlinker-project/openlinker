/**
 * Fiscalization Register Handler (#2156, ADR-041 decision 7)
 *
 * Handles `fiscalization.register` sync jobs — a PURE delegate to
 * `IFiscalRegistrationService`, the `fiscal-receipt` sibling of
 * `InvoicingIssueHandler`. `AutoIssueTriggerService` has already composed the
 * registration command into the job payload, so this handler:
 *  1. Casts + DEEP-validates the payload.
 *  2. Reconstructs the `RegisterTransactionCommand` from the PLAIN payload
 *     (restoring `occurredAt` from its ISO-8601 string back to a `Date`).
 *  3. Calls `fiscalRegistrations.register(command)` with the command
 *     idempotency key equal to `payload.idempotencyKey` (the SAME string as
 *     the job row).
 *
 * OUTCOME CONTRACT DIVERGES FROM `InvoicingIssueHandler` — deliberately, and
 * this is the point, not an oversight. `IFiscalRegistrationService.register`
 * never throws on a provider REJECTION: the outcome (including `failed`) is
 * persisted on the returned `FiscalRegistrationRecord` and the record is
 * returned, so a resolved call is ALWAYS `{ outcome: 'ok' }` here — the job
 * ran to completion, and the record itself (not the job outcome) carries
 * whether the sale was actually registered. `register` DOES still throw five
 * refusals that never cross the provider boundary at all:
 *  - `MissingIdempotencyKeyException` — a malformed payload; should be
 *    unreachable past this handler's own validation, but treated the same way
 *    if it ever fires: terminal `business_failure`.
 *  - `OrderAlreadyRegisteredException` / `OrderAlreadyHasInvoiceException` —
 *    persisted-state FACTS a retry cannot change (#2157's same-kind and
 *    cross-kind guards): terminal `business_failure`.
 *  - `MissingFiscalTaxRateException` — ADR-063's refusal of a sale whose lines
 *    do not all name a tax rate. A fact about persisted data, unchanged by a
 *    retry: terminal `business_failure`.
 *  - `FiscalRegistrationContendedException` — a timing accident a retry
 *    resolves once the peer has persisted its row: retryable, wrapped in
 *    `SyncJobExecutionError`.
 * Any OTHER thrown error (transport/bridge-unreachable) is likewise wrapped as
 * retryable.
 *
 * PII: unlike invoicing's payload, this one carries NO buyer name/address (a
 * fiscal registration names no buyer — see the fiscalization controller's own
 * `rehydrateOrder` doc) — only an optional `recipient` (email/phone). Failure
 * logs still name only ids + error name, never `recipient` / `lines`.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Injectable, Inject } from '@nestjs/common';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
  FiscalizationRegisterPayloadV1,
} from '@openlinker/core/sync';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import {
  IFiscalRegistrationService,
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  MissingIdempotencyKeyException,
  OrderAlreadyRegisteredException,
  OrderAlreadyHasInvoiceException,
  FiscalRegistrationContendedException,
  MissingFiscalTaxRateException,
} from '@openlinker/core/fiscalization';
import type { RegisterTransactionCommand } from '@openlinker/core/fiscalization';
import { isTaxRateEra } from '@openlinker/core/sales-documents';
import { Logger } from '@openlinker/shared/logging';

type SyncJob = SyncJobEntity;

/**
 * Hard ceiling on `lines[]` length. Rejects empty AND over-bound payloads so a
 * pathological job can never balloon the registration call. Mirrors
 * `InvoicingIssueHandler.MAX_INVOICE_LINES`.
 */
export const MAX_FISCAL_LINES = 200;

@Injectable()
export class FiscalizationRegisterHandler implements SyncJobHandler {
  private readonly logger = new Logger(FiscalizationRegisterHandler.name);

  constructor(
    @Inject(FISCAL_REGISTRATION_SERVICE_TOKEN)
    private readonly fiscalRegistrations: IFiscalRegistrationService,
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const payload = this.validatePayload(job);
    if (payload === null) {
      return { outcome: 'business_failure' };
    }

    const command = this.toCommand(payload);

    try {
      // `register` never throws on a provider rejection (see file docstring) —
      // a resolved call is always a completed job, whatever the returned
      // record's own `status`/`failureMode` says.
      await this.fiscalRegistrations.register(command);
      return { outcome: 'ok' };
    } catch (error) {
      if (
        error instanceof MissingIdempotencyKeyException ||
        error instanceof OrderAlreadyRegisteredException ||
        error instanceof OrderAlreadyHasInvoiceException
      ) {
        // Persisted-state facts (or a payload that should be unreachable past
        // validation): a retry can never change the outcome, so this is
        // terminal — never re-crossing the provider boundary to re-assert it.
        this.logger.warn(
          `fiscalization.register skipped: error=${error.name} orderId=${payload.orderId} ` +
            `connectionId=${payload.connectionId}`,
        );
        return { outcome: 'business_failure' };
      }
      // #2260 review: ADR-063's tax-rate refusal, terminal for the same reason
      // the guards above are - a decision about persisted data (a line with no
      // rate), not a transport fault, so it throws identically on every
      // attempt. Left in the retryable catch-all it burned the whole
      // `maxAttempts` budget with backoff and then landed as a `dead` sync job,
      // which reads as an infrastructure incident rather than the catalogue gap
      // it is. Follows `InvoicingIssueHandler`'s treatment of the invoicing
      // twin exactly (ADR-007).
      if (error instanceof MissingFiscalTaxRateException) {
        this.logger.warn(
          // Counts only: `firstLineName` is the shop-authored line LABEL, free
          // text this handler's PII rule forbids logging.
          `fiscalization.register refused: orderId=${payload.orderId} has ` +
            `${String(error.lineCount)} of ${String(error.totalLines)} line(s) with no tax ` +
            `rate; connectionId=${payload.connectionId}. Add the rate in the shop's catalogue ` +
            `and re-sync the product.`,
        );
        return { outcome: 'business_failure' };
      }
      if (error instanceof FiscalRegistrationContendedException) {
        // Retryable: a peer holds the per-order lock and has persisted
        // nothing yet. By the time this retries, it will have.
        throw new SyncJobExecutionError(
          `fiscalization.register contended: orderId=${payload.orderId} connectionId=${payload.connectionId}`,
          job.id,
          job.jobType,
          job.connectionId,
          error,
        );
      }
      // ANY OTHER register() failure (transport/bridge-unreachable) is
      // retryable — the deep pre-validation above has already rejected
      // statically-malformed payloads as business_failure.
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      throw new SyncJobExecutionError(
        `fiscalization.register failed: error=${errorName} orderId=${payload.orderId} connectionId=${payload.connectionId}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * DEEP payload validation. Returns the typed payload on success; returns
   * `null` to signal a `business_failure` outcome on ANY violation:
   *  - `schemaVersion === 1`;
   *  - `connectionId` / `orderId` / `idempotencyKey` / `currency` non-empty strings;
   *  - `lines` an array of `1..MAX_FISCAL_LINES` items, each with `quantity` a
   *    finite number `> 0` and `unitPriceGross` a finite number `>= 0`;
   *  - `totalGross` a finite number;
   *  - `occurredAt` (when present) a non-empty string;
   *  - `recipient` (when present, non-null) an object with `email`/`phone`
   *    each `string | null`.
   */
  private validatePayload(job: SyncJob): FiscalizationRegisterPayloadV1 | null {
    const p = job.payload as unknown as Partial<FiscalizationRegisterPayloadV1>;

    const fail = (field: string): null => {
      this.logger.warn(
        `fiscalization.register payload rejected: field=${field} orderId=${typeof p?.orderId === 'string' ? p.orderId : 'n/a'} connectionId=${job.connectionId} schemaVersion=${String(p?.schemaVersion)}`,
      );
      return null;
    };

    if (!p || typeof p !== 'object') return fail('payload');
    if (p.schemaVersion !== 1) return fail('schemaVersion');
    if (!isNonEmptyString(p.connectionId)) return fail('connectionId');
    if (!isNonEmptyString(p.orderId)) return fail('orderId');
    if (!isNonEmptyString(p.idempotencyKey)) return fail('idempotencyKey');
    if (!isNonEmptyString(p.currency)) return fail('currency');
    if (!isFiniteNumber(p.totalGross)) return fail('totalGross');
    if (p.occurredAt !== undefined && !isNonEmptyString(p.occurredAt)) return fail('occurredAt');

    if (!Array.isArray(p.lines) || p.lines.length < 1 || p.lines.length > MAX_FISCAL_LINES) {
      return fail('lines');
    }
    for (const line of p.lines) {
      if (!line || typeof line !== 'object') return fail('lines.item');
      if (!isFiniteNumber(line.quantity) || line.quantity <= 0) return fail('lines.quantity');
      if (!isFiniteNumber(line.unitPriceGross) || line.unitPriceGross < 0) {
        return fail('lines.unitPriceGross');
      }
    }

    if (p.recipient !== undefined && p.recipient !== null) {
      const recipient = p.recipient;
      if (typeof recipient !== 'object') return fail('recipient');
      if (
        recipient.email !== null &&
        recipient.email !== undefined &&
        typeof recipient.email !== 'string'
      ) {
        return fail('recipient.email');
      }
      if (
        recipient.phone !== null &&
        recipient.phone !== undefined &&
        typeof recipient.phone !== 'string'
      ) {
        return fail('recipient.phone');
      }
    }

    return p as FiscalizationRegisterPayloadV1;
  }

  /**
   * Reconstruct the `RegisterTransactionCommand` from the validated PLAIN
   * payload, carrying `payload.idempotencyKey` as the command idempotency key
   * and restoring `occurredAt` from its ISO-8601 string back to a `Date`.
   */
  private toCommand(payload: FiscalizationRegisterPayloadV1): RegisterTransactionCommand {
    const command: RegisterTransactionCommand = {
      connectionId: payload.connectionId,
      orderId: payload.orderId,
      idempotencyKey: payload.idempotencyKey,
      currency: payload.currency,
      lines: payload.lines,
      totalGross: payload.totalGross,
    };

    if (payload.occurredAt !== undefined) {
      command.occurredAt = new Date(payload.occurredAt);
    }
    if (payload.recipient !== undefined) {
      command.recipient = payload.recipient;
    }
    // #2260 review: the era marker exempts pre-rollout history from the
    // write-path tax-rate guard. Coerced through the union's guard rather than
    // cast - an unrecognised value from an older/newer release must read as "no
    // era" (i.e. the guard applies) instead of silently exempting the order.
    if (isTaxRateEra(payload.taxRateEra)) {
      command.taxRateEra = payload.taxRateEra;
    }

    return command;
  }
}

/** True for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True for a finite (non-NaN, non-Infinity) number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
