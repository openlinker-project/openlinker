/**
 * Catalog Trust Service
 *
 * The operator-facing half of ADR-048 decision 2 (#2258): per ProductMaster
 * connection, which capability rung the master is on, whether the opt-in
 * delta pass is live, and when deletion reconciliation last completed.
 * Read-only — composes IIntegrationsService, ISyncCursorsService and
 * ISyncJobsService via their published seams; no persistence of its own
 * (the analytics-trust shape, #1982).
 *
 * The rung is resolved by GUARD-NARROWING a dispatched adapter
 * (`isModifiedProductLister`), never from a manifest capability name —
 * `ModifiedProductLister` is deliberately absent from every manifest and
 * from `CoreCapabilityValues` (#2220), and `enabledCapabilities` is stamped
 * at connection create and never retro-filled, so a manifest-derived answer
 * would be structurally wrong (#2085's shape). The membership check uses
 * `listCapabilityAdapters({ lazy: true })` — but the rung read goes through
 * `getCapabilityAdapter`, NOT the lazy entry's `.adapter`, because in lazy
 * mode that property is the memoized construction Promise typed as T:
 * narrowing a Promise with the guard would silently classify every
 * connection `'full-enumeration'`.
 *
 * Serve from the API process only — see the interface docblock.
 *
 * @module libs/core/src/catalog-trust/application/services
 * @implements {ICatalogTrustService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { ProductMasterPort} from '@openlinker/core/products';
import { isModifiedProductLister } from '@openlinker/core/products';
import {
  ISyncCursorsService,
  ISyncJobsService,
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_JOBS_SERVICE_TOKEN,
  masterSweepCompletedAtCursorKey,
  masterSweepCursorKey,
} from '@openlinker/core/sync';
import type { ICatalogTrustService } from './catalog-trust.service.interface';
import type {
  ConnectionCatalogTrust,
  MasterCatalogRung,
} from '../../domain/types/catalog-replication-trust.types';

const PRODUCT_MASTER_CAPABILITY = 'ProductMaster';
const DELTA_JOB_TYPE = 'master.product.syncDelta';
const RECONCILE_SWEEP_KIND = 'product-reconcile';

@Injectable()
export class CatalogTrustService implements ICatalogTrustService {
  private readonly logger = new Logger(CatalogTrustService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(SYNC_JOBS_SERVICE_TOKEN)
    private readonly syncJobs: ISyncJobsService
  ) {}

  async getConnectionCatalogTrust(connectionId: string): Promise<ConnectionCatalogTrust | null> {
    // `includeAllStatuses`: a needs_reauth master is exactly the connection
    // the operator is investigating — the default active-only filter would
    // silently drop it (#1982's reasoning). `lazy` keeps the membership
    // check adapter-construction-free for every non-matching connection.
    const entries = await this.integrationsService.listCapabilityAdapters({
      capability: PRODUCT_MASTER_CAPABILITY,
      lazy: true,
      includeAllStatuses: true,
    });
    const entry = entries.find((candidate) => candidate.connectionId === connectionId);
    if (!entry) {
      return null;
    }

    const [rung, lastReconcileCompletedAt, reconcileCycleOpen] = await Promise.all([
      this.resolveRung(connectionId),
      this.readLastReconcileCompletedAt(connectionId),
      this.readReconcileCycleOpen(connectionId),
    ]);

    return {
      connectionId,
      rung,
      deltaPassEnabled: this.syncJobs.findEnabledTaskByJobType(DELTA_JOB_TYPE) !== null,
      lastReconcileCompletedAt,
      reconcileCycleOpen,
    };
  }

  private async resolveRung(connectionId: string): Promise<MasterCatalogRung> {
    try {
      const adapter = await this.integrationsService.getCapabilityAdapter<ProductMasterPort>(
        connectionId,
        PRODUCT_MASTER_CAPABILITY
      );
      return isModifiedProductLister(adapter) ? 'modified-since' : 'full-enumeration';
    } catch (error) {
      // A disabled connection or a credential failure — degrade to a
      // distinct 'unknown' rather than asserting a rung the adapter did not
      // answer for (AC 5; the analytics-trust degradation posture).
      this.logger.warn(
        `Could not resolve ProductMaster adapter for connection ${connectionId} — reporting rung 'unknown': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 'unknown';
    }
  }

  private async readLastReconcileCompletedAt(connectionId: string): Promise<Date | null> {
    const stored = await this.cursors.getCursor(
      connectionId,
      masterSweepCompletedAtCursorKey(RECONCILE_SWEEP_KIND, connectionId)
    );
    if (stored === null || stored.length === 0) {
      return null;
    }
    const parsed = new Date(stored);
    if (Number.isNaN(parsed.getTime())) {
      // Malformed is treated as absent rather than throwing — a corrupt
      // display cursor must never break the trust read (the delta
      // handler's parseWatermark posture).
      this.logger.warn(
        `Malformed reconcile completedAt cursor for connection ${connectionId}: ${stored}`
      );
      return null;
    }
    return parsed;
  }

  private async readReconcileCycleOpen(connectionId: string): Promise<boolean> {
    const stored = await this.cursors.getCursor(
      connectionId,
      masterSweepCursorKey(RECONCILE_SWEEP_KIND, connectionId)
    );
    // '' is the completing branch's clear; a non-empty value means a cycle
    // is OPEN (started, not completed) — not necessarily actively running.
    return stored !== null && stored.length > 0;
  }
}
