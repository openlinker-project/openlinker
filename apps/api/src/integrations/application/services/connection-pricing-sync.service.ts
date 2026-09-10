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
 * @module apps/api/src/integrations/application/services
 * @implements {IConnectionPricingSyncService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CONNECTION_PORT_TOKEN,
  type ConnectionPort,
  type Connection,
  type ConnectionConfig,
  readPricingRuleConfig,
  readPriceSyncModeConfig,
  readPricingRuleForSource,
  readPriceSyncModeForSource,
} from '@openlinker/core/identifier-mapping';
import {
  PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN,
  type PriceChangeEpisodeRepositoryPort,
} from '@openlinker/core/listings';
import { CONNECTION_SERVICE_TOKEN, type IConnectionService } from '../interfaces/connection.service.interface';
import type { IConnectionPricingSyncService } from '../interfaces/connection-pricing-sync.service.interface';
import type {
  ConnectionAsSourceEntry,
  ConnectionPricingSyncView,
  UpdateConnectionPricingSyncInput,
} from '../types/connection-pricing-sync.types';

@Injectable()
export class ConnectionPricingSyncService implements IConnectionPricingSyncService {
  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connectionService: IConnectionService,
    @Inject(PRICE_CHANGE_EPISODE_REPOSITORY_TOKEN)
    private readonly episodes: PriceChangeEpisodeRepositoryPort
  ) {}

  async getPricingSync(connectionId: string): Promise<ConnectionPricingSyncView> {
    const connection = await this.connections.get(connectionId);
    return this.buildView(connection);
  }

  async updatePricingSync(
    connectionId: string,
    input: UpdateConnectionPricingSyncInput
  ): Promise<ConnectionPricingSyncView> {
    const connection = await this.connections.get(connectionId);

    const sourceOverridesRule: Record<string, ConnectionPricingSyncView['default']['rule']> = {};
    const sourceOverridesMode: Record<string, ConnectionPricingSyncView['default']['mode']> = {};
    for (const [sourceId, setting] of Object.entries(input.sourceOverrides)) {
      sourceOverridesRule[sourceId] = setting.rule;
      sourceOverridesMode[sourceId] = setting.mode;
    }

    const updatedConfig: ConnectionConfig = {
      ...connection.config,
      pricingRule: { default: input.default.rule, sourceOverrides: sourceOverridesRule },
      priceSyncMode: { default: input.default.mode, sourceOverrides: sourceOverridesMode },
    };

    const updated = await this.connectionService.update(connectionId, { config: updatedConfig });
    return this.buildView(updated);
  }

  async getAsSource(connectionId: string): Promise<ConnectionAsSourceEntry[]> {
    const allConnections = await this.connections.list();
    const openEpisodesAsSource = await this.episodes.findOpenAll({ sourceConnectionId: connectionId });
    const destinationIdsFromEpisodes = new Set(
      openEpisodesAsSource.map((e) => e.destinationConnectionId)
    );

    const entries: ConnectionAsSourceEntry[] = [];
    for (const destination of allConnections) {
      if (destination.id === connectionId) {
        continue;
      }
      const pricingConfig = readPricingRuleConfig(destination.config);
      const syncConfig = readPriceSyncModeConfig(destination.config);
      const isCustomOverride =
        connectionId in pricingConfig.sourceOverrides || connectionId in syncConfig.sourceOverrides;
      const knownAsSource = isCustomOverride || destinationIdsFromEpisodes.has(destination.id);
      if (!knownAsSource) {
        continue;
      }

      entries.push({
        destinationConnectionId: destination.id,
        destinationLabel: destination.name,
        effectiveMode: readPriceSyncModeForSource(destination.config, connectionId),
        effectiveRuleSummary: readPricingRuleForSource(destination.config, connectionId) ?? {
          type: 'passthrough',
          percent: 0,
          rounding: 'none',
        },
        isCustomOverride,
      });
    }
    return entries;
  }

  private async buildView(connection: Connection): Promise<ConnectionPricingSyncView> {
    const pricingConfig = readPricingRuleConfig(connection.config);
    const syncConfig = readPriceSyncModeConfig(connection.config);

    const sourceIds = new Set<string>([
      ...Object.keys(pricingConfig.sourceOverrides),
      ...Object.keys(syncConfig.sourceOverrides),
    ]);

    const openEpisodes = await this.episodes.findOpenForConnection(connection.id);
    for (const episode of openEpisodes) {
      sourceIds.add(episode.sourceConnectionId);
    }

    const sources = [];
    for (const sourceId of sourceIds) {
      const sourceConnection = await this.connections.get(sourceId).catch(() => null);
      const openEpisodeCount = await this.episodes.countOpen({
        destinationConnectionId: connection.id,
        sourceConnectionId: sourceId,
      });
      sources.push({
        sourceConnectionId: sourceId,
        sourceLabel: sourceConnection?.name ?? 'Unknown connection',
        isCustomOverride: sourceId in pricingConfig.sourceOverrides || sourceId in syncConfig.sourceOverrides,
        effective: {
          mode: syncConfig.sourceOverrides[sourceId] ?? syncConfig.default,
          rule: pricingConfig.sourceOverrides[sourceId] ?? pricingConfig.default ?? {
            type: 'passthrough' as const,
            percent: 0,
            rounding: 'none' as const,
          },
        },
        openEpisodeCount,
      });
    }

    return {
      default: {
        mode: syncConfig.default,
        rule: pricingConfig.default ?? { type: 'passthrough', percent: 0, rounding: 'none' },
      },
      sources,
    };
  }
}
