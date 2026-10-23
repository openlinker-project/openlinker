/**
 * Connection Diagnostics Service
 *
 * Composes one connection's recent activity across the three sources the
 * diagnostics panel reports on (#3179): its `sync_jobs`, its
 * `FiscalRegistrationRecord`s and its `InvoiceRecord`s. Read-only projection —
 * never calls a destination platform, never consumes a rate-limit slot.
 *
 * A document registration is real activity on a connection whether or not the
 * `sync_jobs` row that dispatched it still sits inside this read's own recency
 * window, so the three sources are read independently rather than inferring
 * document activity from job rows alone.
 *
 * **The three reads are independently fallible, and a failure must never read
 * as a confirmed zero.** They run under `Promise.allSettled`, NOT
 * `Promise.all`: this panel is exactly what an operator opens when something is
 * broken, and `Promise.all` would let a fiscalization- or invoicing-table
 * outage take down a read that used to depend on `sync_jobs` alone. A rejected
 * leg folds in as "no observations from that source" and is named in
 * `unreadableSources`, so no caller can turn an unread source into a confirmed
 * "Never" — the `analytics-trust` / `catalog-trust` / `sync-status` precedent
 * of a distinct `unknown` rather than a silently healthy-looking zero.
 *
 * Composed here rather than in `ConnectionController` for the reason
 * `RateLimitStatusService` / `WebhookStatusService` are (and `AuthorityStatusService`
 * after them): `docs/engineering-standards.md` keeps controllers to validate,
 * delegate and format, and the per-source degradation policy is behaviour worth
 * unit-testing without standing up a controller module.
 *
 * @module apps/api/src/integrations/application/services
 * @implements {IConnectionDiagnosticsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { SYNC_JOB_REPOSITORY_TOKEN, type SyncJobRepositoryPort } from '@openlinker/core/sync';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  type IFiscalRegistrationService,
} from '@openlinker/core/fiscalization';
import { INVOICE_SERVICE_TOKEN, type IInvoiceService } from '@openlinker/core/invoicing';
import { Logger } from '@openlinker/shared/logging';
import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../interfaces/connection.service.interface';
import type { IConnectionDiagnosticsService } from '../interfaces/connection-diagnostics.service.interface';
import type {
  ConnectionDiagnosticsReads,
  ConnectionDiagnosticsSource,
} from '../types/connection-diagnostics.types';

/**
 * Cap on each connection-scoped activity read — enough to surface a genuinely
 * recent registration, never an unbounded per-connection scan.
 */
const RECENT_ACTIVITY_LIMIT = 10;

@Injectable()
export class ConnectionDiagnosticsService implements IConnectionDiagnosticsService {
  private readonly logger = new Logger(ConnectionDiagnosticsService.name);

  constructor(
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connectionService: IConnectionService,
    @Inject(SYNC_JOB_REPOSITORY_TOKEN)
    private readonly syncJobRepository: SyncJobRepositoryPort,
    @Inject(FISCAL_REGISTRATION_SERVICE_TOKEN)
    private readonly fiscalRegistrations: IFiscalRegistrationService,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService
  ) {}

  async getDiagnostics(connectionId: string): Promise<ConnectionDiagnosticsReads> {
    // Read BEFORE the fan-out and deliberately NOT inside it: a connection that
    // does not exist is a 404, not a degraded panel about nothing.
    const connection = await this.connectionService.get(connectionId);

    const [jobsResult, fiscalResult, invoicesResult] = await Promise.allSettled([
      this.syncJobRepository.findRecentByConnectionId(connectionId, RECENT_ACTIVITY_LIMIT),
      this.fiscalRegistrations.listRecentByConnectionId(connectionId, RECENT_ACTIVITY_LIMIT),
      // Bounded recency read, NOT the paginated `listInvoices`: that one ends
      // in `getManyAndCount()`, whose COUNT always runs in `typeorm@0.3.17`,
      // and this read discards a total (#2944, and
      // `docs/engineering-standards.md` § When A Paginated Total Is Expensive).
      this.invoices.listRecentByConnectionId(connectionId, RECENT_ACTIVITY_LIMIT),
    ]);

    const unreadableSources: ConnectionDiagnosticsSource[] = [];

    return {
      connection,
      recentJobs: this.unwrap(jobsResult, 'syncJobs', connectionId, unreadableSources) ?? [],
      recentFiscalRegistrations:
        this.unwrap(fiscalResult, 'fiscalRegistrations', connectionId, unreadableSources) ?? [],
      recentInvoices:
        this.unwrap(invoicesResult, 'invoices', connectionId, unreadableSources) ?? [],
      unreadableSources,
    };
  }

  /**
   * Unwraps one leg of the fan-out. A rejection is logged and recorded in
   * `unreadableSources` rather than thrown — the whole point of `allSettled`
   * here is that one unreadable source must not take down the other two, or
   * the panel itself.
   */
  private unwrap<T>(
    result: PromiseSettledResult<T>,
    source: ConnectionDiagnosticsSource,
    connectionId: string,
    unreadableSources: ConnectionDiagnosticsSource[]
  ): T | undefined {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    this.logger.warn(
      `Could not read '${source}' for connection diagnostics (connection ${connectionId}): ${
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      }`
    );
    unreadableSources.push(source);
    return undefined;
  }
}
