/**
 * Pending Recovery Service (#1703, mini-epic #1585, ADR-035)
 *
 * Core application service that resolves one connection's invoice records left
 * STUCK by a mid-issuance process crash. Two shapes qualify, and they are NOT
 * fiscally equivalent, so this sweep treats them differently (#1585 I3):
 *
 *  - `status='pending'` (NEVER CLAIMED): the crash happened before the CAS claim,
 *    so NOTHING was ever transmitted to the authority - unambiguously safe to
 *    re-drive. It is NOT marked in-doubt (that would both strand an order with no
 *    document AND make `claimForIssue` permanently exclude the row). Instead the
 *    sweep RE-DRIVES issuance by requeuing the original `invoicing.issue` job
 *    (`requeueDeadByIdempotencyKey`): re-running the SAME idempotency-keyed job
 *    resumes issuance against the existing record via the service's `issued`-only
 *    exactly-once gate (no double-issue). When there is no dead job to requeue
 *    (keyless issue, pruned job, or a job still self-driving) the record is left
 *    `pending` (claimable) - never in-doubt.
 *
 *  - `status='issuing'` with a lapsed CAS lease (CRASHED POST-CLAIM): a submit
 *    MAY have reached the authority before the crash, so OL cannot decide
 *    retry-vs-orphan from its own state. It queries the authority through the
 *    `RegulatoryRecordLocator` ADR-002 sub-capability:
 *      - FOUND -> reconcile (`status='issued'`, the located regulatory status,
 *        clearance reference set), WARN "recovered orphaned invoice".
 *      - NOT FOUND (or the adapter has no locator) -> FISCAL-SAFE: mark
 *        `status='failed'` with the `in-doubt` failure mode + operator-visible
 *        alert, and do NOT auto-retry. A silent re-issue would risk
 *        DOUBLE-ISSUING a document whose interrupted attempt actually landed.
 *
 * Depends ONLY on ports (`InvoiceRecordRepositoryPort` + `IIntegrationsService` +
 * `ISyncJobsService`, the last already an established invoicing->sync edge used by
 * `AutoIssueTriggerService`), never concrete adapters; nothing from
 * `libs/integrations` is imported and no `faktura`/`ksef`/`NIP` vocabulary lives
 * here (ADR-026 neutral core). Mirrors the 3-layer #1121/#1702 sweep pattern.
 *
 * Paging is a `(updatedAt, id)` KEYSET CURSOR walked across pages WITHIN one run.
 * Error discipline: per-record errors are caught, counted, and logged BOUNDED;
 * nothing re-throws past the per-record loop.
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IPendingRecoveryService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import { ISyncJobsService, SYNC_JOBS_SERVICE_TOKEN } from '@openlinker/core/sync';

import type {
  IPendingRecoveryService,
  PendingRecoveryOptions,
  PendingRecoveryResult,
} from './pending-recovery.service.interface';
import { ISSUING_LEASE_MS } from './invoice.service';
import {
  MAX_PAGES_PER_RUN,
  LOCATE_DATE_WINDOW_MS,
  sanitizeError,
  businessMillisElapsed,
  PENDING_SUBMISSION_LINGER_BUSINESS_MS,
} from './invoice-sweep-support';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import { INVOICE_RECORD_REPOSITORY_TOKEN } from '../../invoicing.tokens';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import { isRegulatoryRecordLocator } from '../../domain/ports/capabilities/regulatory-record-locator.capability';
import type { RegulatoryRecordLocator } from '../../domain/ports/capabilities/regulatory-record-locator.capability';
import type {
  InvoiceOutcomePatch,
  RegulatoryLocateCriteria,
  RegulatoryLocateResult,
} from '../../domain/types/invoicing.types';

/** Capability the connection must declare; the locator is a runtime-detected sub-capability. */
const INVOICING_CAPABILITY = 'Invoicing';

/**
 * Safety margin, in milliseconds, a record must be stuck BEYOND its CAS lease
 * (`issuing`) or its last update (`pending`) before this sweep touches it. Set to
 * one extra `ISSUING_LEASE_MS` window: for an `issuing` row the total dead time
 * before recovery is `ISSUING_LEASE_MS` (the lease itself) PLUS this margin, so a
 * legitimately in-flight provider call - or a concurrent retry about to re-claim
 * an expiring lease - can always finish first and can never be swept mid-flight
 * (the fiscal double-issue guard, aligned with the same `ISSUING_LEASE_MS >
 * MAX_SUPPORTED_PROVIDER_TIMEOUT_MS` invariant `InvoiceService` enforces). Small
 * enough that a true orphan is resolved within ~2 lease windows.
 */
export const STUCK_PENDING_SAFETY_MARGIN_MS = ISSUING_LEASE_MS;

/**
 * Fixed, PII-free operator-facing summary for an orphaned `issuing` record that
 * could not be confirmed on the authority side. Deliberately a constant (never an
 * echo of provider/buyer data) so `failureReason` can never leak PII. Explicitly
 * warns a duplicate may already exist (#1585 suggestion): a blind re-issue is
 * unsafe, so the operator must verify with the authority first.
 */
const IN_DOUBT_FAILURE_REASON =
  'Issuance was interrupted after the document may have reached the authority; a document may ' +
  'already exist. Verify with the authority before re-issuing - a blind retry could create a duplicate.';

@Injectable()
export class PendingRecoveryService implements IPendingRecoveryService {
  private readonly logger = new Logger(PendingRecoveryService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobs: ISyncJobsService,
  ) {}

  async recover(
    connectionId: string,
    opts: PendingRecoveryOptions,
  ): Promise<PendingRecoveryResult> {
    const result: PendingRecoveryResult = {
      scanned: 0,
      recovered: 0,
      reissued: 0,
      markedInDoubt: 0,
      errors: 0,
      total: 0,
    };

    // Resolve the per-connection Invoicing adapter. The record locator is a
    // runtime sub-capability (ADR-002); an adapter without one still needs its
    // stuck `issuing` records resolved, so a missing locator is NOT a skip - it
    // degrades to the fiscal-safe in-doubt path per record (never a silent
    // auto-retry). The never-claimed `pending` arm needs no locator (it re-drives).
    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      connectionId,
      INVOICING_CAPABILITY,
    );
    const locator = isRegulatoryRecordLocator(adapter) ? adapter : null;
    if (!locator) {
      this.logger.warn(
        `Connection ${connectionId} Invoicing adapter does not implement RegulatoryRecordLocator - ` +
          `stuck post-claim (issuing) records cannot be confirmed on the authority side and will be marked in-doubt for manual review.`,
      );
    }

    // Lingering-deadline observability (#1585 F6). Emitted from THIS always-on
    // sweep (not the offline-resubmit sweep, which defaults OFF, #1585 B1) so a
    // pending-submission document accruing toward its next-business-day
    // transmission deadline is surfaced even when auto-resubmission is disabled.
    await this.warnOnLingeringPendingSubmission(connectionId);

    // `olderThan` = now - safety margin. The repo predicate gates both the
    // `pending` (updatedAt) and `issuing` (leaseExpiresAt) arms by this instant,
    // so a record must have been stuck at least the safety margin before it is
    // selected - a live attempt is never swept mid-flight.
    const olderThan = new Date(Date.now() - STUCK_PENDING_SAFETY_MARGIN_MS);

    let cursor: { updatedAt: Date; id: string } | undefined;
    let pages = 0;
    let totalCaptured = false;

    while (pages < MAX_PAGES_PER_RUN) {
      const { items, total } = await this.repo.findStuckPending(connectionId, {
        olderThan,
        limit: opts.limit,
        cursor,
      });
      if (!totalCaptured) {
        result.total = total;
        totalCaptured = true;
      }
      pages += 1;

      for (const record of items) {
        // Advance the keyset cursor for EVERY scanned row (before any
        // continue) so the next page never re-reads it - forward progress does
        // not depend on a successful recovery.
        cursor = { updatedAt: record.updatedAt, id: record.id };
        result.scanned += 1;

        // Safety-net observability (issue item 2): a record reaching this sweep
        // sat non-terminal past the expected issuance window.
        this.logger.warn(
          `Invoice record ${record.id} (connection=${connectionId}, status=${record.status}) sat non-terminal ` +
            `longer than the expected issuance window (> ${STUCK_PENDING_SAFETY_MARGIN_MS}ms past its lease); attempting crash recovery.`,
        );

        try {
          if (record.status === 'pending') {
            // Never-claimed => never transmitted => re-drive, never in-doubt (#1585 I3).
            if (await this.redriveNeverClaimed(connectionId, record)) {
              result.reissued += 1;
            }
            continue;
          }
          // `issuing` (crashed post-claim): may have landed -> authority lookup.
          const recovered = await this.recoverOne(connectionId, locator, record);
          if (recovered) {
            result.recovered += 1;
          } else {
            result.markedInDoubt += 1;
          }
        } catch (error) {
          // Per-record errors are caught, counted, and logged BOUNDED - never
          // the raw provider string. The sweep continues; nothing re-throws past
          // the loop. A transient failure just leaves the record for the next run.
          result.errors += 1;
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error(
            `Pending recovery failed (connection=${connectionId}, record=${record.id}): ${err.name}: ${sanitizeError(error)}`,
          );
          continue;
        }
      }

      // A short (or empty) page means the frontier is drained - stop. A full page
      // means more rows may follow the cursor; fetch the next page.
      if (items.length < opts.limit) {
        break;
      }
    }

    if (pages >= MAX_PAGES_PER_RUN) {
      this.logger.warn(
        `Pending recovery hit the per-run page cap (${MAX_PAGES_PER_RUN}) for connection ${connectionId}; remaining rows will be picked up next run (no permanent skip).`,
      );
    }

    return result;
  }

  /**
   * Re-drive a never-claimed `pending` record (#1585 I3). Nothing was transmitted,
   * so re-running the ORIGINAL `invoicing.issue` job (by its idempotency key)
   * safely resumes issuance against the existing row through the service's
   * `issued`-only exactly-once gate. Returns `true` when a dead job was requeued;
   * `false` (record left `pending`, claimable) when there is no dead job to
   * re-drive - a keyless issue, a pruned job, or a job still self-driving.
   */
  private async redriveNeverClaimed(connectionId: string, record: InvoiceRecord): Promise<boolean> {
    if (!record.idempotencyKey) {
      // Keyless issue: no dedup job to requeue. Leave the row `pending` (still
      // claimable) for manual re-issue rather than stranding it in-doubt.
      this.logger.warn(
        `Stuck pending invoice ${record.id} (connection=${connectionId}) has no idempotency key to re-drive; ` +
          `left pending (claimable) for manual re-issue - NOT marked in-doubt (nothing was transmitted).`,
      );
      return false;
    }
    const requeued = await this.syncJobs.requeueDeadByIdempotencyKey(record.idempotencyKey);
    if (requeued) {
      this.logger.warn(
        `Re-drove issuance for never-claimed pending invoice ${record.id} (connection=${connectionId}): ` +
          `requeued its dead invoicing.issue job (nothing was transmitted, so no double-issue).`,
      );
    } else {
      this.logger.warn(
        `Stuck pending invoice ${record.id} (connection=${connectionId}): no dead issue job to re-drive ` +
          `(still queued/running or pruned); left pending (claimable) - NOT marked in-doubt.`,
      );
    }
    return requeued;
  }

  /**
   * Recover one stuck `issuing` record. Returns `true` when it was reconciled to
   * a confirmed issued outcome, `false` when it was marked in-doubt for manual
   * review. Throws only on a transport/infra failure of the authority lookup.
   */
  private async recoverOne(
    connectionId: string,
    locator: (InvoicingPort & RegulatoryRecordLocator) | null,
    record: InvoiceRecord,
  ): Promise<boolean> {
    const located = locator ? await locator.locateByQuery(this.buildCriteria(record)) : null;

    if (located) {
      await this.repo.updateOutcome(record.id, this.buildRecoveredPatch(located));
      this.logger.warn(
        `Recovered orphaned invoice ${record.id} (connection=${connectionId}): found on the authority side ` +
          `(regulatoryStatus=${located.regulatoryStatus}); reconciled to its located outcome.`,
      );
      return true;
    }

    // NOT FOUND or no locator: fiscal-safe in-doubt. Never auto-retry.
    await this.repo.updateOutcome(record.id, this.buildInDoubtPatch());
    this.logger.warn(
      `Orphaned invoice ${record.id} (connection=${connectionId}) could not be confirmed on the authority side; ` +
        `marked failed (in-doubt) for manual reconciliation - NOT auto-retried (fiscal double-issue guard).`,
    );
    return false;
  }

  /**
   * Aggregate lingering-deadline WARN (#1585 F6). Reads the oldest
   * `pending-submission` record for the connection plus the total count (page-1
   * only, O(1) off the per-record path) and WARNs once per run when the oldest has
   * lingered beyond `PENDING_SUBMISSION_LINGER_BUSINESS_MS` of BUSINESS time - so a
   * Friday-evening outage does not raise a Saturday alarm for a deadline that is
   * really Monday. Observability only: never a state change (a pending-submission
   * document is legally issued and must not be auto-failed). The escalation to a
   * push / email / KPI is a documented follow-up. A read failure is swallowed
   * (never breaks the crash-recovery sweep it rides on).
   */
  private async warnOnLingeringPendingSubmission(connectionId: string): Promise<void> {
    let oldest: InvoiceRecord | undefined;
    let total = 0;
    try {
      const page = await this.repo.findPendingSubmission(connectionId, { limit: 1 });
      oldest = page.items[0];
      total = page.total;
    } catch (error) {
      this.logger.warn(
        `Lingering pending-submission check failed for connection ${connectionId}: ${sanitizeError(error)}`,
      );
      return;
    }
    if (!oldest) {
      return;
    }
    const anchor = oldest.issuedAt ?? oldest.createdAt ?? oldest.updatedAt;
    const businessAgeMs = businessMillisElapsed(anchor, new Date());
    if (businessAgeMs >= PENDING_SUBMISSION_LINGER_BUSINESS_MS) {
      this.logger.warn(
        `Connection ${connectionId} has a pending-submission invoice lingering ~${Math.round(businessAgeMs / 3_600_000)}h ` +
          `of business time (oldest record ${oldest.id}; ${total} pending-submission total). A next-business-day ` +
          `transmission deadline may be accruing - check the authority's availability, enable offline resubmission, ` +
          `or reconcile manually.`,
      );
    }
  }

  /**
   * Derive the authority-lookup criteria from the record. `sellerTaxId` is
   * absent from the projection, so it is omitted (the adapter falls back to its
   * own configured seller identity); `documentNumber` uses the OL-allocated legal
   * number when present, else the provider's own number. The issue-date window is
   * anchored on the record's issue/last-touch instant with a generous margin,
   * because a crashed attempt may not have persisted `issuedAt`.
   */
  private buildCriteria(record: InvoiceRecord): RegulatoryLocateCriteria {
    const anchor = record.issuedAt ?? record.updatedAt;
    return {
      documentNumber: record.documentNumber ?? record.providerInvoiceNumber ?? undefined,
      issuedFrom: new Date(anchor.getTime() - LOCATE_DATE_WINDOW_MS),
      issuedTo: new Date(anchor.getTime() + LOCATE_DATE_WINDOW_MS),
    };
  }

  /**
   * Patch for a record confirmed present on the authority side. The located
   * regulatory status is written through verbatim; `status` is flipped to
   * `issued` ONLY for a non-rejected outcome (#1585 suggestion) - a located
   * `rejected` must not persist the contradictory `issued + rejected` pair, so it
   * leaves the issuance status unset and records only the rejection. Clearance
   * reference / provider id are set ONLY when the lookup surfaced a non-null value
   * so a prior value is never clobbered to null. Clears the CAS lease.
   */
  private buildRecoveredPatch(located: RegulatoryLocateResult): InvoiceOutcomePatch {
    const patch: InvoiceOutcomePatch = {
      regulatoryStatus: located.regulatoryStatus,
      leaseExpiresAt: null,
    };
    if (located.regulatoryStatus !== 'rejected') {
      patch.status = 'issued';
    }
    if (located.providerInvoiceId != null) {
      patch.providerInvoiceId = located.providerInvoiceId;
    }
    if (located.clearanceReference != null) {
      patch.clearanceReference = located.clearanceReference;
    }
    return patch;
  }

  /**
   * Patch for an orphaned `issuing` record whose authority-side outcome is unknown:
   * mark it `failed` with the `in-doubt` failure mode (UNSAFE to auto-re-attempt -
   * the document MAY already exist) + the `transport-timeout` failure code
   * (#1585 I8: its FE copy correctly warns a duplicate is possible, unlike
   * `provider-error`'s "nothing was issued, retry") and a PII-free operator-facing
   * reason. Clears the CAS lease.
   */
  private buildInDoubtPatch(): InvoiceOutcomePatch {
    return {
      status: 'failed',
      failureMode: 'in-doubt',
      failureCode: 'transport-timeout',
      failureReason: IN_DOUBT_FAILURE_REASON,
      errorMessage: IN_DOUBT_FAILURE_REASON,
      leaseExpiresAt: null,
    };
  }
}
