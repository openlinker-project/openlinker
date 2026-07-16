/**
 * Pending Recovery Service (#1703, mini-epic #1585, ADR-035)
 *
 * Core application service that resolves one connection's invoice records left
 * STUCK by a mid-issuance process crash - a worker killed between a successful
 * provider submit and the terminal `updateOutcome`, so `closeSession` never ran
 * and the row stayed `status='pending'` (never claimed) or `status='issuing'`
 * with a lapsed CAS lease. `POST /invoices/retry` deliberately skips `pending`
 * and nothing else revisits it, so this scheduled sweep is the recovery path.
 *
 * OL cannot decide retry-vs-orphan from its own state (did the authority receive
 * the document before the crash?), so it queries the authority through the
 * `RegulatoryRecordLocator` ADR-002 sub-capability:
 *   - FOUND -> reconcile: patch `status='issued'`, `regulatoryStatus='accepted'`,
 *     set the clearance reference, WARN "recovered orphaned invoice".
 *   - NOT FOUND (or the adapter has no locator) -> FISCAL-SAFE: mark
 *     `status='failed'` with the `in-doubt` failure mode + an operator-visible
 *     alert (WARN + `errorMessage`/`failureReason`), and do NOT auto-retry. A
 *     silent re-issue would risk DOUBLE-ISSUING a fiscal document whose original
 *     interrupted attempt actually landed; the fiscal-safety rule is that any
 *     uncertainty resolves to in-doubt + a human, never an automatic re-attempt.
 *
 * Depends ONLY on ports (`InvoiceRecordRepositoryPort` + `IIntegrationsService`),
 * never concrete adapters; nothing from `libs/integrations` is imported and no
 * `faktura`/`ksef`/`NIP` vocabulary lives here (ADR-026 neutral core). Mirrors the
 * 3-layer #1121/#1702 sweep pattern (core service + worker handler + scheduler).
 *
 * Paging is a `(updatedAt, id)` KEYSET CURSOR walked across pages WITHIN one run
 * (mirrors `OfflineResubmissionService`). `opts.limit` is the per-PAGE size; the
 * sweep keeps fetching the next page - bounded strictly after the last-seen
 * `(updatedAt, id)` - until a short page drains the frontier, capping pages at
 * `MAX_PAGES_PER_RUN`. The cursor advances PAST every scanned row regardless of
 * outcome, so a record whose recovery throws cannot pin the front of the window
 * and starve newer rows.
 *
 * Error discipline: per-record errors are caught, counted, and logged BOUNDED
 * (ids + error.name + sanitized message only) - never the raw provider string;
 * nothing re-throws past the per-record loop (a transient authority failure just
 * leaves the record for the next run).
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

import type {
  IPendingRecoveryService,
  PendingRecoveryOptions,
  PendingRecoveryResult,
} from './pending-recovery.service.interface';
import { ISSUING_LEASE_MS } from './invoice.service';
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
 * Max length of a sanitized, operator-facing recovery-error diagnostic. A
 * `RegulatoryRecordLocator` adapter is third-party-shaped and its error may echo
 * authority/buyer-side data - bound it before logging (same idiom as the
 * offline-resubmit / reconcile sweeps).
 */
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Runaway guard on the intra-run keyset page walk. The walk normally terminates
 * when a page returns fewer than `limit` rows; this caps the worst case so a
 * single run cannot spin unboundedly.
 */
const MAX_PAGES_PER_RUN = 1000;

/**
 * Half-width of the issue-date window handed to the authority lookup. A crashed
 * attempt may not have persisted its exact issue date, so the window is anchored
 * on the record's issue/last-touch instant with a full day either side - wide
 * enough to catch a document whose authority-side issue date drifted from OL's
 * recorded instant, narrow enough that the metadata query stays selective.
 */
const LOCATE_DATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Fixed, PII-free operator-facing summary for an orphaned record that could not
 * be confirmed on the authority side. Deliberately a constant (never an echo of
 * provider/buyer data) so `failureReason` can never leak PII.
 */
const IN_DOUBT_FAILURE_REASON =
  'Issuance was interrupted and could not be confirmed with the authority; manual reconciliation required.';

@Injectable()
export class PendingRecoveryService implements IPendingRecoveryService {
  private readonly logger = new Logger(PendingRecoveryService.name);

  constructor(
    @Inject(INVOICE_RECORD_REPOSITORY_TOKEN)
    private readonly repo: InvoiceRecordRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
  ) {}

  async recover(
    connectionId: string,
    opts: PendingRecoveryOptions,
  ): Promise<PendingRecoveryResult> {
    const result: PendingRecoveryResult = {
      scanned: 0,
      recovered: 0,
      markedInDoubt: 0,
      errors: 0,
      total: 0,
    };

    // Resolve the per-connection Invoicing adapter. The record locator is a
    // runtime sub-capability (ADR-002); an adapter without one still needs its
    // stuck records resolved, so a missing locator is NOT a skip - it degrades to
    // the fiscal-safe in-doubt path per record (never a silent auto-retry).
    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      connectionId,
      INVOICING_CAPABILITY,
    );
    const locator = isRegulatoryRecordLocator(adapter) ? adapter : null;
    if (!locator) {
      this.logger.warn(
        `Connection ${connectionId} Invoicing adapter does not implement RegulatoryRecordLocator - ` +
          `stuck records cannot be confirmed on the authority side and will be marked in-doubt for manual review.`,
      );
    }

    // `olderThan` = now - safety margin. The repo predicate gates both the
    // `pending` (updatedAt) and `issuing` (leaseExpiresAt) arms by this instant,
    // so a record must have been stuck at least the safety margin before it is
    // selected - a live attempt is never swept mid-flight.
    const olderThan = new Date(Date.now() - STUCK_PENDING_SAFETY_MARGIN_MS);

    // Intra-run KEYSET page walk (mirrors OfflineResubmissionService). `total`
    // (full stuck frontier count, cursor-independent) is captured from page 1.
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
        // sat non-terminal past the expected issuance window. Emit it here as the
        // single home for that WARN/metric.
        this.logger.warn(
          `Invoice record ${record.id} (connection=${connectionId}, status=${record.status}) sat non-terminal ` +
            `longer than the expected issuance window (> ${STUCK_PENDING_SAFETY_MARGIN_MS}ms past its lease); attempting crash recovery.`,
        );

        try {
          const recovered = await this.recoverOne(connectionId, locator, record);
          if (recovered) {
            result.recovered += 1;
          } else {
            result.markedInDoubt += 1;
          }
        } catch (error) {
          // Per-record errors are caught, counted, and logged BOUNDED - never
          // the raw provider string. The sweep continues; nothing re-throws past
          // the loop. A transient authority failure just leaves the record for
          // the next run (it stays stuck, so it is re-selected).
          result.errors += 1;
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error(
            `Pending recovery failed (connection=${connectionId}, record=${record.id}): ${err.name}: ${this.sanitizeError(error)}`,
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
   * Recover one stuck record. Returns `true` when it was reconciled to a
   * confirmed issued/accepted outcome, `false` when it was marked in-doubt for
   * manual review. Throws only on a transport/infra failure of the authority
   * lookup (the caller counts + swallows it).
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
          `(regulatoryStatus=${located.regulatoryStatus}); reconciled to issued/accepted.`,
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
   * Patch for a record confirmed present on the authority side: it was issued and
   * has cleared. `clearanceReference` / `providerInvoiceId` are set ONLY when the
   * lookup surfaced a non-null value so a prior value is never clobbered to null.
   * Clears the CAS lease (the interrupted attempt is over).
   */
  private buildRecoveredPatch(located: RegulatoryLocateResult): InvoiceOutcomePatch {
    const patch: InvoiceOutcomePatch = {
      status: 'issued',
      regulatoryStatus: located.regulatoryStatus,
      leaseExpiresAt: null,
    };
    if (located.providerInvoiceId != null) {
      patch.providerInvoiceId = located.providerInvoiceId;
    }
    if (located.clearanceReference != null) {
      patch.clearanceReference = located.clearanceReference;
    }
    return patch;
  }

  /**
   * Patch for an orphaned record whose authority-side outcome is unknown: mark it
   * `failed` with the `in-doubt` failure mode (UNSAFE to auto-re-attempt - the
   * document MAY already exist) + the neutral `provider-error` code and a PII-free
   * operator-facing reason. Clears the CAS lease.
   */
  private buildInDoubtPatch(): InvoiceOutcomePatch {
    return {
      status: 'failed',
      failureMode: 'in-doubt',
      failureCode: 'provider-error',
      failureReason: IN_DOUBT_FAILURE_REASON,
      errorMessage: IN_DOUBT_FAILURE_REASON,
      leaseExpiresAt: null,
    };
  }

  /**
   * Length-bounded, operator-facing diagnostic for a per-record recovery error.
   * INTERNAL-ONLY; may contain provider-echoed data - never log the raw,
   * unbounded message to an external sink.
   */
  private sanitizeError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    if (raw.length <= MAX_ERROR_MESSAGE_LENGTH) {
      return raw;
    }
    const marker = '…[truncated]';
    return raw.slice(0, MAX_ERROR_MESSAGE_LENGTH - marker.length) + marker;
  }
}
