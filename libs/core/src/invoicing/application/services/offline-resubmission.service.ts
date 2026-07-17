/**
 * Offline Resubmission Service (#1702, mini-epic #1585, ADR-035)
 *
 * Core application service that retransmits one connection's `pending-submission`
 * invoice records - documents issued with legal effect during a degraded-mode
 * clearance-authority outage - by calling the `OfflineResubmitter` ADR-002
 * sub-capability once the authority recovers, then persisting the returned
 * `regulatoryStatus` / `providerInvoiceId` / `clearanceReference`. Depends ONLY on
 * ports (`InvoiceRecordRepositoryPort` + `IIntegrationsService`), never concrete
 * adapters; nothing from `libs/integrations` is imported. No
 * `faktura`/`ksef`/`NIP` vocabulary lives here (ADR-026 neutral core).
 *
 * v1 scope (#1702 task 6): resubmit whenever the authority recovers. Legal
 * deadline-window tracking (next-business-day for a bounded offline grace period)
 * is DEFERRED - a still-unreachable authority simply leaves the record
 * `pending-submission` for the next run. A record that lingers there is surfaced
 * by the always-on `PendingRecoveryService` sweep's business-day-aware
 * lingering WARN (#1585 F6), not here - so the signal fires even when THIS sweep
 * is disabled (it defaults OFF until its wire contract is verified, #1585 B1).
 * See part 4 (docs) for the escalation (email / KPI) follow-up.
 *
 * Double-issue guard (#1585 B1, three-layer, fails CLOSED):
 *  1. Settling margin: a record is only considered `settlingMarginMs` after its
 *     last touch, so a document that LANDED at the authority but is not yet
 *     visible in its eventually-consistent metadata index has time to appear
 *     before a `null` locate is trusted as a genuine non-receipt.
 *  2. Per-record CAS claim (`claimPendingSubmission`): each record is leased
 *     before any authority call, so two overlapping runs (or a run racing the
 *     live path) can never both see `null` and both resubmit the same document.
 *  3. Confirm-non-receipt: when the adapter is a `RegulatoryRecordLocator`, the
 *     sweep locates the document by its `documentNumber` FIRST and, if FOUND,
 *     reconciles WITHOUT resubmitting. An adapter that is NOT a locator cannot
 *     confirm receipt, so the sweep does NOT blind-resubmit it (fiscal safety) -
 *     it leaves the record `pending-submission` for manual handling, surfaced by
 *     the `PendingRecoveryService` lingering WARN.
 *
 * Paging is a `(updatedAt, id)` KEYSET CURSOR walked across pages WITHIN one run
 * (mirrors `RegulatoryStatusReconciliationService`). `opts.limit` is the per-PAGE
 * size; the sweep keeps fetching the next page - bounded strictly after the
 * last-seen `(updatedAt, id)` - until a short page drains the frontier, capping
 * pages at `MAX_PAGES_PER_RUN`. The cursor advances PAST every scanned row
 * regardless of whether it was written, so a record whose authority is still down
 * (no write, no `updatedAt` bump) cannot pin the front of the window and starve
 * newer rows.
 *
 * Error & write discipline (mirrors the reconcile sweep):
 *  - write-on-change: the patch omits a key whose value is null/unchanged;
 *    `providerInvoiceId` / `clearanceReference` are monotonic;
 *  - per-record errors are caught, counted, and logged BOUNDED (ids +
 *    error.name / sanitized message only) - never the raw provider string, and
 *    the CAS lease is RELEASED so the next run can re-claim the record;
 *  - nothing re-throws past the per-record loop.
 *
 * @module libs/core/src/invoicing/application/services
 * @implements {IOfflineResubmissionService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';

import type {
  IOfflineResubmissionService,
  OfflineResubmissionOptions,
  OfflineResubmissionResult,
} from './offline-resubmission.service.interface';
import { ISSUING_LEASE_MS } from './invoice.service';
import {
  LOCATE_DATE_WINDOW_MS,
  MAX_PAGES_PER_RUN,
  sanitizeError,
} from './invoice-sweep-support';
import type { InvoiceRecord } from '../../domain/entities/invoice-record.entity';
import { InvoiceRecordRepositoryPort } from '../../domain/ports/invoice-record-repository.port';
import { INVOICE_RECORD_REPOSITORY_TOKEN } from '../../invoicing.tokens';
import type { InvoicingPort } from '../../domain/ports/invoicing.port';
import { isOfflineResubmitter } from '../../domain/ports/capabilities/offline-resubmitter.capability';
import type { OfflineResubmitter } from '../../domain/ports/capabilities/offline-resubmitter.capability';
import { isRegulatoryRecordLocator } from '../../domain/ports/capabilities/regulatory-record-locator.capability';
import type { RegulatoryRecordLocator } from '../../domain/ports/capabilities/regulatory-record-locator.capability';
import type {
  InvoiceOutcomePatch,
  OfflineResubmitResult,
  RegulatoryLocateCriteria,
} from '../../domain/types/invoicing.types';

/** Capability the connection must declare; the resubmitter is a runtime-detected sub-capability. */
const INVOICING_CAPABILITY = 'Invoicing';

/**
 * DEFAULT settling margin a `pending-submission` record must age before this
 * sweep considers it (#1585 B1 / F4). Host-tunable via
 * `OfflineResubmissionOptions.settlingMarginMs`.
 *
 * Deliberately NOT `ISSUING_LEASE_MS` (#1585 F4): the CAS-lease window sizes a
 * synchronous submit round-trip, but the confirm-non-receipt gate must instead
 * outlast the authority's eventually-consistent metadata-INDEX lag — and the
 * offline window is entered precisely because the authority was unavailable, so
 * on recovery that indexing can trail by tens of minutes. Set to 30 minutes
 * (materially larger than the ~5-minute lease): long enough that a landed-but-
 * unindexed document reliably surfaces before a `null` locate is trusted as a
 * genuine non-receipt, short enough that a real backlog still drains promptly.
 */
export const OFFLINE_RESUBMIT_SETTLING_MARGIN_MS = 30 * 60 * 1000;

/**
 * Lease TTL for a per-record resubmit CAS claim (#1585 B1). One
 * `ISSUING_LEASE_MS` window - long enough to cover the open→submit→close round
 * trip, short enough that a crashed run's lease frees the record for the next.
 */
export const OFFLINE_RESUBMIT_LEASE_MS = ISSUING_LEASE_MS;

@Injectable()
export class OfflineResubmissionService implements IOfflineResubmissionService {
  private readonly logger = new Logger(OfflineResubmissionService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async resubmit(
    connectionId: string,
    opts: OfflineResubmissionOptions,
  ): Promise<OfflineResubmissionResult> {
    const result: OfflineResubmissionResult = {
      scanned: 0,
      updated: 0,
      resubmitErrors: 0,
      total: 0,
    };

    // Resolve the per-connection Invoicing adapter. The resubmitter is a runtime
    // sub-capability (ADR-002) - an adapter with no degraded-mode window is a
    // clean no-op (warn + zeroed result), NEVER a throw: the scheduler fans out
    // to every Invoicing connection and most never implement it.
    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      connectionId,
      INVOICING_CAPABILITY,
    );

    if (!isOfflineResubmitter(adapter)) {
      this.logger.warn(
        `Connection ${connectionId} Invoicing adapter does not implement OfflineResubmitter - skipping offline resubmission (no-op).`,
      );
      return result;
    }

    // The locator is a runtime-detected sub-capability (ADR-002) used to confirm
    // non-receipt before a resubmit (#1585 B1). An adapter WITHOUT it cannot
    // confirm receipt, so - unlike the pre-#1585 blind-resubmit - the sweep does
    // NOT resubmit its records at all (fiscal safety: a submit-timeout-after-
    // landing would double-issue). Such records stay `pending-submission` and are
    // surfaced by the PendingRecoveryService lingering WARN for manual handling.
    const locator = isRegulatoryRecordLocator(adapter) ? adapter : null;
    if (!locator) {
      this.logger.warn(
        `Connection ${connectionId} Invoicing adapter does not implement RegulatoryRecordLocator - ` +
          `cannot confirm non-receipt, so offline records will NOT be auto-resubmitted (fiscal safety); ` +
          `they remain pending-submission for manual reconciliation.`,
      );
    }

    // Settling margin (#1585 B1 / F4): only records untouched for at least the
    // host-tunable settling margin are eligible, so a landed-but-unindexed
    // document has time to surface in the authority's metadata index. Defaults to
    // OFFLINE_RESUBMIT_SETTLING_MARGIN_MS (30 min), sized to outlast index lag.
    const settlingMarginMs = opts.settlingMarginMs ?? OFFLINE_RESUBMIT_SETTLING_MARGIN_MS;
    const olderThan = new Date(Date.now() - settlingMarginMs);

    // Intra-run KEYSET page walk. `total` (full frontier count, cursor-independent)
    // is captured from page 1.
    let cursor: { updatedAt: Date; id: string } | undefined;
    let pages = 0;
    let totalCaptured = false;
    let locateCalls = 0;

    while (pages < MAX_PAGES_PER_RUN) {
      const { items, total } = await this.repo.findPendingSubmission(connectionId, {
        limit: opts.limit,
        cursor,
        olderThan,
      });
      if (!totalCaptured) {
        result.total = total;
        totalCaptured = true;
      }
      pages += 1;

      for (const record of items) {
        // Advance the keyset cursor for EVERY scanned row (before any
        // skip/continue) so the next page never re-reads it - forward progress
        // does not depend on a successful resubmit.
        cursor = { updatedAt: record.updatedAt, id: record.id };
        result.scanned += 1;

        // No-locator: fail closed. Cannot confirm receipt -> never resubmit.
        if (!locator) {
          continue;
        }

        // Per-record CAS claim (#1585 B1). A lost claim means an overlapping run
        // (or the live path) already holds this record - skip WITHOUT resubmitting.
        let claimed: InvoiceRecord | null;
        try {
          claimed = await this.repo.claimPendingSubmission(
            record.id,
            new Date(Date.now() + OFFLINE_RESUBMIT_LEASE_MS),
          );
        } catch (error) {
          result.resubmitErrors += 1;
          this.logResubmitError(connectionId, record.id, error);
          continue;
        }
        if (claimed === null) {
          continue;
        }

        try {
          locateCalls += 1;
          // Confirm non-receipt BEFORE resubmitting. If the document already
          // landed at the authority, reconcile it in place (releasing the lease)
          // and skip the resubmit - a blind resubmit would double-issue.
          if (await this.reconcileIfAlreadyLanded(connectionId, locator, claimed, result)) {
            continue;
          }

          const outcome = await this.resubmitOne(adapter, claimed);
          await this.persistResubmitOutcome(claimed, outcome, result);
        } catch (error) {
          // Per-record errors (locate OR resubmit) are caught, counted, logged
          // BOUNDED, and the CAS lease is RELEASED so the next run can re-claim.
          result.resubmitErrors += 1;
          this.logResubmitError(connectionId, claimed.id, error);
          await this.releaseLease(claimed.id);
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
        `Offline resubmission hit the per-run page cap (${MAX_PAGES_PER_RUN}) for connection ${connectionId}; remaining rows will be picked up next run (no permanent skip).`,
      );
    }

    // Rate-limit metric (#1585 suggestion): one authority lookup fires per claimed
    // record, so on a large frontier this can pressure the provider's rate limit.
    if (locateCalls > 0) {
      this.logger.log(
        `Offline resubmission performed ${locateCalls} authority lookup(s) for connection ${connectionId} ` +
          `(scanned ${result.scanned}, updated ${result.updated}, errors ${result.resubmitErrors}).`,
      );
    }

    return result;
  }

  /**
   * Persist a resubmit outcome (write-on-change) and ALWAYS release the CAS lease.
   * When the resubmit left the record still `pending-submission` (#1585 intra-run
   * re-submit suggestion) only the lease is released.
   *
   * Within-run non-re-selection safety comes from the SETTLING-MARGIN filter, NOT
   * from skipping a write (#1585 S2): the lease-release `updateOutcome` still
   * `save()`s and bumps `updatedAt`, so the row's key moves - but because the
   * page query only selects rows with `updatedAt <= now - settlingMargin`, the
   * freshly-bumped row is excluded from every later page in the same run. The CAS
   * claim is the belt to that suspenders (a re-selected row would fail to re-claim
   * anyway).
   */
  private async persistResubmitOutcome(
    record: InvoiceRecord,
    outcome: OfflineResubmitResult,
    result: OfflineResubmissionResult,
  ): Promise<void> {
    const changePatch = this.buildPatch(record, outcome);
    const stillPending = outcome.regulatoryStatus === 'pending-submission';
    const patch: InvoiceOutcomePatch = stillPending
      ? { leaseExpiresAt: null }
      : { ...changePatch, leaseExpiresAt: null };
    await this.repo.updateOutcome(record.id, patch);
    if (!stillPending && Object.keys(changePatch).length > 0) {
      result.updated += 1;
    }
  }

  /**
   * Build the outcome patch by CONDITIONAL KEY INSERTION. Each field is set ONLY
   * when the resubmit surfaced a non-null, changed value so `updateOutcome`'s
   * `Object.assign` cannot NULL a prior value: `providerInvoiceId` /
   * `clearanceReference` are monotonic (an offline issuance could not know them,
   * and a later resubmit that yields none must not wipe an earlier one).
   */
  private buildPatch(record: InvoiceRecord, outcome: OfflineResubmitResult): InvoiceOutcomePatch {
    const patch: InvoiceOutcomePatch = {};

    if (outcome.regulatoryStatus !== record.regulatoryStatus) {
      patch.regulatoryStatus = outcome.regulatoryStatus;
    }

    if (outcome.providerInvoiceId != null && outcome.providerInvoiceId !== record.providerInvoiceId) {
      patch.providerInvoiceId = outcome.providerInvoiceId;
    }

    if (
      outcome.clearanceReference != null &&
      outcome.clearanceReference !== record.clearanceReference
    ) {
      patch.clearanceReference = outcome.clearanceReference;
    }

    return patch;
  }

  /**
   * Confirm-non-receipt gate (#1585 B1). Locate the record on the authority side
   * by its `documentNumber`; when FOUND, reconcile it in place (write-on-change,
   * releasing the CAS lease) and return `true` so the caller skips the resubmit -
   * the document already landed, so resubmitting would double-issue. Returns
   * `false` when the authority holds no match (a genuine non-receipt), leaving the
   * caller to resubmit. A transport/infra failure of the lookup throws for the
   * caller's per-record catch (which releases the lease).
   */
  private async reconcileIfAlreadyLanded(
    connectionId: string,
    locator: InvoicingPort & RegulatoryRecordLocator,
    record: InvoiceRecord,
    result: OfflineResubmissionResult,
  ): Promise<boolean> {
    const located = await locator.locateByQuery(this.buildLocateCriteria(record));
    if (!located) {
      return false;
    }

    // `RegulatoryLocateResult` is structurally the same triple as
    // `OfflineResubmitResult`, so the write-on-change patch builder handles it.
    // Always release the CAS lease alongside the reconcile.
    const patch: InvoiceOutcomePatch = { ...this.buildPatch(record, located), leaseExpiresAt: null };
    await this.repo.updateOutcome(record.id, patch);
    if (Object.keys(patch).length > 1) {
      result.updated += 1;
    }
    this.logger.warn(
      `Offline record ${record.id} (connection=${connectionId}) was already present on the authority side ` +
        `(regulatoryStatus=${located.regulatoryStatus}); reconciled WITHOUT resubmitting (duplicate-issue guard).`,
    );
    return true;
  }

  /**
   * Best-effort CAS-lease release so a record left `pending-submission` (a
   * resubmit error) can be re-claimed by the next run. A failure here is logged,
   * never rethrown - the lease TTL is the backstop.
   */
  private async releaseLease(id: string): Promise<void> {
    try {
      await this.repo.updateOutcome(id, { leaseExpiresAt: null });
    } catch (error) {
      this.logger.warn(
        `Failed to release offline-resubmit lease on record ${id}; the lease TTL will free it: ${sanitizeError(error)}`,
      );
    }
  }

  /**
   * Derive the authority-lookup criteria for the confirm-non-receipt gate.
   * `documentNumber` uses the OL-allocated legal number (present on every
   * pending-submission row) with the provider number as a fallback; the issue-date
   * window is anchored on the record's issue/last-touch instant. `sellerTaxId` is
   * omitted (the adapter falls back to its own configured seller identity).
   */
  private buildLocateCriteria(record: InvoiceRecord): RegulatoryLocateCriteria {
    const anchor = record.issuedAt ?? record.updatedAt;
    return {
      documentNumber: record.documentNumber ?? record.providerInvoiceNumber ?? undefined,
      issuedFrom: new Date(anchor.getTime() - LOCATE_DATE_WINDOW_MS),
      issuedTo: new Date(anchor.getTime() + LOCATE_DATE_WINDOW_MS),
    };
  }

  /**
   * Resubmit one record via the narrowed resubmitter adapter. Wrapped by the
   * per-record try/catch in `resubmit`.
   */
  private async resubmitOne(
    adapter: InvoicingPort & OfflineResubmitter,
    record: InvoiceRecord,
  ): Promise<OfflineResubmitResult> {
    return adapter.resubmit(record);
  }

  /** Bounded, PII-guarded per-record error log (shared sanitizer). */
  private logResubmitError(connectionId: string, recordId: string, error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(
      `Offline resubmission failed (connection=${connectionId}, record=${recordId}): ${err.name}: ${sanitizeError(error)}`,
    );
  }
}
