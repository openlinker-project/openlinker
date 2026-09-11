/**
 * Connection Pricing & Sync Service (#3146, ADR-072)
 *
 * Read/write orchestration for a destination connection's default + per-
 * source pricing rule and sync mode, plus the READ-ONLY rollup for a
 * connection acting as a SOURCE (ADR-072 decision 2 — the source connection
 * never gets an editable rule of its own).
 *
 * "Known sources" for both reads (#3146's stated assumption) is the union
 * of every source id already declared in `config.pricingRule.sourceOverrides`
 * / `config.priceSyncMode.sourceOverrides`, plus every source that currently
 * has an OPEN price-change episode against this destination — so a source
 * that has fed a destination but never been given its own rule still
 * appears (mirroring the mockup's `PRICING_CONFIG[destKey].sources`, which
 * always lists every known source, override or not).
 *
 * **Cross-context read (#3163 review, BLOCKING finding 1).** The open-episode
 * counts/ids come from `IPriceChangesService`
 * (`@openlinker/core/listings`) — a service interface, never
 * `PriceChangeEpisodeRepositoryPort` directly. `*RepositoryPort` is a deny
 * pattern for cross-context imports (`docs/architecture-overview.md §
 * Cross-context dependencies in core`); the core-to-core allow-list is
 * empty by design (#2791) and fails the build on a stale row, so this is not
 * an allow-listing candidate. `countOpenBySource` / `listOpenDestinationConnectionIds`
 * return distinct ids (+ counts, for the destination side) rather than
 * hydrated episode rows — the same call also closes the read-cost finding
 * below, since neither read needs a second per-source query in a loop.
 *
 * @module apps/api/src/integrations/application/services
 * @implements {IConnectionPricingSyncService}
 */
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  CONNECTION_PORT_TOKEN,
  type ConnectionPort,
  type Connection,
  type ConnectionConfig,
  type PriceSyncMode,
  type PricingRule,
  readPricingRuleConfig,
  readPriceSyncModeConfig,
  readPricingRuleForSource,
  readPriceSyncModeForSource,
} from '@openlinker/core/identifier-mapping';
import {
  PRICE_CHANGES_SERVICE_TOKEN,
  type IPriceChangesService,
} from '@openlinker/core/listings';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { CONNECTION_SERVICE_TOKEN, type IConnectionService } from '../interfaces/connection.service.interface';
import type { IConnectionPricingSyncService } from '../interfaces/connection-pricing-sync.service.interface';
import type {
  ConnectionAsSourceEntry,
  ConnectionPricingSyncView,
  UpdateConnectionPricingSyncInput,
} from '../types/connection-pricing-sync.types';

/**
 * Capabilities that make a connection a viable pricing-rule DESTINATION
 * (ADR-072 decision 2: "a default rule + optional per-source overrides live
 * on the DESTINATION connection ... never its own editable copy" for the
 * feeding source). Mirrors `PriceChangeApplyService.publishPrice`'s
 * marketplace-vs-shop capability check, but tested against
 * `supportedCapabilities` ALONE (never `enabledCapabilities`, which per
 * #2085 is stamped at create and never retro-filled — gating on it would
 * refuse a legitimate destination whose operator simply hasn't flipped the
 * capability on yet).
 */
const DESTINATION_CAPABILITIES = ['OfferManager', 'ProductPublisher'] as const;

/**
 * Lock TTL — sized to comfortably exceed a `get` + `update` round trip,
 * mirroring `PRICE_SYNC_MODE_LOCK_TTL_MS` (#3162 review): the lock closes
 * the read-modify-write race between this endpoint and #3162's
 * `optInAutomatic` / the review queue's Undo, both of which write the same
 * two `Connection.config` keys from other call sites.
 */
const PRICING_SYNC_LOCK_TTL_MS = 15_000;

@Injectable()
export class ConnectionPricingSyncService implements IConnectionPricingSyncService {
  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connectionService: IConnectionService,
    @Inject(PRICE_CHANGES_SERVICE_TOKEN)
    private readonly priceChanges: IPriceChangesService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort
  ) {}

  async getPricingSync(connectionId: string): Promise<ConnectionPricingSyncView> {
    const connection = await this.connections.get(connectionId);
    return this.buildView(connection);
  }

  async updatePricingSync(
    connectionId: string,
    input: UpdateConnectionPricingSyncInput
  ): Promise<ConnectionPricingSyncView> {
    const lockKey = `pricing:sync:${connectionId}`;
    const token = await this.lock.acquire(lockKey, PRICING_SYNC_LOCK_TTL_MS);
    if (!token) {
      throw new ConflictException(
        "Another update to this connection's pricing & sync settings is already in progress. " +
          'Try again in a moment.'
      );
    }

    try {
      const connection = await this.connections.get(connectionId);

      if (
        input.expectedUpdatedAt !== undefined &&
        connection.updatedAt.toISOString() !== input.expectedUpdatedAt
      ) {
        throw new ConflictException(
          "This connection's pricing & sync settings were changed elsewhere since this page was " +
            'loaded. Reload and re-apply your changes.'
        );
      }

      await this.assertViableDestination(connection);

      const sourceOverridesRule: Record<string, PricingRule> = {};
      const sourceOverridesMode: Record<string, PriceSyncMode> = {};
      for (const [sourceId, setting] of Object.entries(input.sourceOverrides)) {
        // Independent axes (#3163 review, finding 5): only write the half
        // the caller actually supplied, so opting a source into `automatic`
        // (#3162's `optInAutomatic`, which writes ONLY `priceSyncMode`)
        // never materializes a `pricingRule.sourceOverrides` entry the
        // operator never authored.
        if (setting.mode !== undefined) {
          sourceOverridesMode[sourceId] = setting.mode;
        }
        if (setting.rule !== undefined && setting.rule !== null) {
          sourceOverridesRule[sourceId] = setting.rule;
        }
      }

      const updatedConfig: ConnectionConfig = {
        ...connection.config,
        pricingRule: { default: input.default.rule, sourceOverrides: sourceOverridesRule },
        priceSyncMode: { default: input.default.mode, sourceOverrides: sourceOverridesMode },
      };

      // Goes through IConnectionService.update, which re-validates the
      // widened shape (validateStockAndPricingConfig — margin ceiling
      // included) and re-runs adapter config-shape validation before
      // persisting; ConnectionRepository.update is a full-row
      // read-modify-write, which is exactly what the lock above serializes
      // against #3162's writer and the review queue's Undo.
      const updated = await this.connectionService.update(connectionId, { config: updatedConfig });
      return this.buildView(updated);
    } finally {
      try {
        await this.lock.release(lockKey, token);
      } catch {
        // Best-effort — the lock's own TTL is the backstop.
      }
    }
  }

  async getAsSource(connectionId: string): Promise<ConnectionAsSourceEntry[]> {
    const allConnections = await this.connections.list();
    const destinationIdsFromEpisodes = await this.priceChanges.listOpenDestinationConnectionIds(
      connectionId
    );
    const destinationIdSet = new Set(destinationIdsFromEpisodes);

    const entries: ConnectionAsSourceEntry[] = [];
    for (const destination of allConnections) {
      if (destination.id === connectionId) {
        continue;
      }
      const pricingConfig = readPricingRuleConfig(destination.config);
      const syncConfig = readPriceSyncModeConfig(destination.config);
      const modeOverridden = connectionId in syncConfig.sourceOverrides;
      const ruleOverridden = connectionId in pricingConfig.sourceOverrides;
      const knownAsSource = modeOverridden || ruleOverridden || destinationIdSet.has(destination.id);
      if (!knownAsSource) {
        continue;
      }

      entries.push({
        destinationConnectionId: destination.id,
        destinationLabel: destination.name,
        effectiveMode: readPriceSyncModeForSource(destination.config, connectionId),
        effectiveRuleSummary: readPricingRuleForSource(destination.config, connectionId),
        modeOverridden,
        ruleOverridden,
      });
    }
    return entries;
  }

  /**
   * ADR-072 decision 2 is a documented invariant, not merely a form-level
   * convention (#3163 review, finding 7 — the only place enforcing it before
   * this was the browser). Resolves adapter metadata by platform/adapterKey
   * (never constructs an adapter, so it works on a `disabled` connection —
   * the #2353 `AuthorityStatusService` precedent) and refuses the write
   * outright when the connection cannot possibly publish a price through
   * either destination shape.
   */
  private async assertViableDestination(connection: Connection): Promise<void> {
    const metadata = await this.integrationsService.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: connection.adapterKey,
    });

    const isViableDestination = DESTINATION_CAPABILITIES.some((capability) =>
      metadata.supportedCapabilities.includes(capability)
    );
    if (!isViableDestination) {
      throw new BadRequestException(
        `Connection ${connection.id} (adapter ${metadata.adapterKey}) cannot receive a pricing ` +
          'rule: its adapter supports neither OfferManager nor ProductPublisher, so ADR-072 ' +
          'decision 2 reserves the default rule + per-source overrides to a viable destination ' +
          "connection. Configure pricing on the destination connection that publishes this " +
          'catalog instead.'
      );
    }
  }

  private async buildView(connection: Connection): Promise<ConnectionPricingSyncView> {
    const pricingConfig = readPricingRuleConfig(connection.config);
    const syncConfig = readPriceSyncModeConfig(connection.config);

    const openCountsBySource = await this.priceChanges.countOpenBySource(connection.id);

    const sourceIds = new Set<string>([
      ...Object.keys(pricingConfig.sourceOverrides),
      ...Object.keys(syncConfig.sourceOverrides),
      ...openCountsBySource.keys(),
    ]);

    // One batched read rather than one `connections.get()` per source
    // (#3163 review, finding 6 — the #2083 rule).
    const allConnections = await this.connections.list();
    const connectionsById = new Map(allConnections.map((c) => [c.id, c] as const));

    const sources = [...sourceIds].map((sourceId) => {
      const sourceConnection = connectionsById.get(sourceId);
      const modeOverridden = sourceId in syncConfig.sourceOverrides;
      const ruleOverridden = sourceId in pricingConfig.sourceOverrides;
      return {
        sourceConnectionId: sourceId,
        sourceLabel: sourceConnection?.name ?? 'Unknown connection',
        modeOverridden,
        ruleOverridden,
        effective: {
          mode: syncConfig.sourceOverrides[sourceId] ?? syncConfig.default,
          rule: pricingConfig.sourceOverrides[sourceId] ?? pricingConfig.default,
        },
        openEpisodeCount: openCountsBySource.get(sourceId) ?? 0,
      };
    });

    return {
      default: {
        mode: syncConfig.default,
        rule: pricingConfig.default,
      },
      sources,
    };
  }
}
