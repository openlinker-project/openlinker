/**
 * Stock View Service (#3621)
 *
 * The interface-layer composition behind the operator's stock panel. The core
 * `IInventoryQueryService.getStockViewByVariantIds` answers everything that is
 * inventory's to know; this service adds what only the API layer may join:
 *
 * - the channels a variant is published on, which needs `listings`
 *   (`ListingsModule` imports `InventoryModule`, so `inventory` cannot import
 *   it back without a module cycle - the same reason `products.controller.ts`
 *   composes listings coverage here);
 * - each channel's Controls and "will publish" figure, through
 *   `IAvailabilityService` only - the buffer helpers have exactly one reader
 *   (`libs/core/src/__tests__/no-direct-buffer-read.spec.ts`);
 * - what each marketplace REPORTS showing (decision G-3), from persisted
 *   snapshots - no marketplace call;
 * - display names for locations, connections and orders.
 *
 * **Nothing here invents a number.** An unknown available-to-promise stays
 * unknown all the way down: a channel's "will publish" is `unknown`, never a
 * quantity, and a channel snapshot that was never taken is `null`, never `0`.
 *
 * @module apps/api/src/inventory/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import { CONNECTION_PORT_TOKEN, type ConnectionPort } from '@openlinker/core/identifier-mapping';
import {
  AVAILABILITY_SERVICE_TOKEN,
  INVENTORY_QUERY_SERVICE_TOKEN,
  LOCATION_SERVICE_TOKEN,
  type AvailabilityProvenance,
  type IAvailabilityService,
  type IInventoryQueryService,
  type ILocationService,
  type VariantStockView,
} from '@openlinker/core/inventory';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  OFFER_COMMERCIAL_READ_SERVICE_TOKEN,
  PUBLISHED_VARIANTS_SERVICE_TOKEN,
  type IOfferCommercialReadService,
  type IPublishedVariantsService,
} from '@openlinker/core/listings';
import {
  OPERATIONAL_SETTINGS_SERVICE_TOKEN,
  type IOperationalSettingsService,
  type OperationalSettingSource,
} from '@openlinker/core/operational-settings';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  buildOrderSummary,
  type IOrderRecordService,
} from '@openlinker/core/orders';
import {
  PRODUCTS_SERVICE_TOKEN,
  type IProductsService,
  type ProductVariant,
} from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

const HOUR_MS = 3_600_000;
/** Fallback when the settings row cannot be read: the documented default. */
const DEFAULT_STALE_SYNC_THRESHOLD_HOURS = 6;
/** The capabilities whose connections can publish a variant somewhere. */
const CHANNEL_CAPABILITIES = ['OfferManager', 'ProductPublisher'] as const;
/** Cap on concurrent per-connection name lookups. */
const NAME_LOOKUP_CONCURRENCY = 10;
const LEGACY_SOURCE_CONNECTION_ID = 'legacy';

export interface StaleSyncThreshold {
  readonly hours: number;
  readonly ms: number;
  /** Which rung produced the value, so the UI can explain it. */
  readonly source: OperationalSettingSource;
}

export interface StockViewChannelRule {
  readonly stockSafetyBuffer: number;
  readonly stockZeroThreshold: number;
}

export interface StockViewChannel {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly platformType: string;
  /** `null` when the connection's Controls could not be read. */
  readonly rule: StockViewChannelRule | null;
  readonly willPublish: {
    readonly quantity: number | null;
    readonly provenance: AvailabilityProvenance;
  };
  /** What the marketplace last reported; both `null` when never observed. */
  readonly channelShows: {
    readonly quantity: number | null;
    readonly observedAt: Date | null;
  };
}

export interface StockViewPositionDetail {
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly sourceConnectionId: string | null;
  readonly sourceConnectionName: string | null;
  readonly isStale: boolean;
  readonly availableQuantity: number;
  readonly reservedQuantity: number;
  readonly updatedAt: Date;
}

export interface StockViewHoldDetail {
  readonly orderRecordId: string;
  /** Source-native order number; `null` when it could not be resolved. */
  readonly orderNumber: string | null;
  readonly quantity: number;
  readonly atpEffect: 'published' | 'diagnostic';
  readonly expiresAt: Date;
}

export interface StockViewVariantDetail
  extends Omit<VariantStockView, 'positions' | 'holds'> {
  readonly sku: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  readonly positions: readonly StockViewPositionDetail[];
  readonly holds: readonly StockViewHoldDetail[] | null;
  readonly channels: readonly StockViewChannel[];
}

/** `ok` = every channel read; `partial` = some omitted; `unavailable` = none could be listed. */
export type ChannelsStatus = 'ok' | 'partial' | 'unavailable';

export interface ProductStockView {
  readonly productId: string;
  readonly productName: string;
  readonly productSku: string | null;
  readonly staleSyncThreshold: StaleSyncThreshold;
  readonly channelsStatus: ChannelsStatus;
  readonly variants: readonly StockViewVariantDetail[];
}

/** Product exists check failed: the controller maps it to 404. */
export class StockViewProductNotFoundError extends Error {
  constructor(productId: string) {
    super(`Product not found: ${productId}`);
    this.name = 'StockViewProductNotFoundError';
  }
}

@Injectable()
export class StockViewService {
  private readonly logger = new Logger(StockViewService.name);

  constructor(
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQuery: IInventoryQueryService,
    @Inject(AVAILABILITY_SERVICE_TOKEN)
    private readonly availability: IAvailabilityService,
    @Inject(LOCATION_SERVICE_TOKEN)
    private readonly locations: ILocationService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(PUBLISHED_VARIANTS_SERVICE_TOKEN)
    private readonly publishedVariants: IPublishedVariantsService,
    @Inject(OFFER_COMMERCIAL_READ_SERVICE_TOKEN)
    private readonly commercial: IOfferCommercialReadService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(OPERATIONAL_SETTINGS_SERVICE_TOKEN)
    private readonly settings: IOperationalSettingsService
  ) {}

  /**
   * The stale-sync threshold in force. A settings read failure falls back to
   * the documented default rather than failing a stock read - the threshold
   * only decides a flag, and the response names the rung it came from.
   */
  async getStaleSyncThreshold(): Promise<StaleSyncThreshold> {
    try {
      const view = await this.settings.resolve();
      const { value, source } = view.stockStaleSyncThresholdHours;
      return { hours: value, ms: value * HOUR_MS, source };
    } catch (error) {
      this.logger.error(
        'stock_view_threshold_read_failed - falling back to the default threshold',
        (error as Error).stack
      );
      return {
        hours: DEFAULT_STALE_SYNC_THRESHOLD_HOURS,
        ms: DEFAULT_STALE_SYNC_THRESHOLD_HOURS * HOUR_MS,
        source: 'default',
      };
    }
  }

  /** The core stock view for a batch of variants, with the threshold applied. */
  async getVariantStockViews(
    variantIds: readonly string[]
  ): Promise<readonly VariantStockView[]> {
    const threshold = await this.getStaleSyncThreshold();
    return this.inventoryQuery.getStockViewByVariantIds({
      variantIds,
      staleSyncThresholdMs: threshold.ms,
    });
  }

  async getProductStockView(productId: string): Promise<ProductStockView> {
    const product = await this.products.getProduct(productId);
    if (product === null) throw new StockViewProductNotFoundError(productId);

    const variants = await this.products.getVariantsByProductId(productId);
    const variantIds = variants.map((v) => v.id);
    const threshold = await this.getStaleSyncThreshold();
    const views = await this.inventoryQuery.getStockViewByVariantIds({
      variantIds,
      staleSyncThresholdMs: threshold.ms,
    });

    const [channelResult, locationNames, connectionNames, orderNumbers] = await Promise.all([
      this.resolveChannels(variantIds, views),
      this.resolveLocationNames(views),
      this.resolveSourceConnectionNames(views),
      this.resolveOrderNumbers(views),
    ]);

    const variantById = new Map<string, ProductVariant>(variants.map((v) => [v.id, v]));
    const details = views.map((view): StockViewVariantDetail => {
      const variant = variantById.get(view.productVariantId);
      const { positions, holds, ...rest } = view;
      return {
        ...rest,
        sku: variant?.sku ?? null,
        attributes: variant?.attributes ?? {},
        positions: positions.map((p) => ({
          locationId: p.locationId,
          locationName: p.locationId ? (locationNames.get(p.locationId) ?? null) : null,
          sourceConnectionId: p.sourceConnectionId,
          sourceConnectionName: p.sourceConnectionId
            ? (connectionNames.get(p.sourceConnectionId) ?? null)
            : null,
          isStale: p.isStale,
          availableQuantity: p.availableQuantity,
          reservedQuantity: p.reservedQuantity,
          updatedAt: p.updatedAt,
        })),
        holds:
          holds === null
            ? null
            : holds.map((h) => ({
                orderRecordId: h.orderRecordId,
                orderNumber: orderNumbers.get(h.orderRecordId) ?? null,
                quantity: h.quantity,
                atpEffect: h.atpEffect,
                expiresAt: h.expiresAt,
              })),
        channels: channelResult.channelsByVariant.get(view.productVariantId) ?? [],
      };
    });

    return {
      productId,
      productName: product.name,
      productSku: product.sku,
      staleSyncThreshold: threshold,
      channelsStatus: channelResult.status,
      variants: details,
    };
  }

  private async resolveChannels(
    variantIds: readonly string[],
    views: readonly VariantStockView[]
  ): Promise<{ status: ChannelsStatus; channelsByVariant: Map<string, StockViewChannel[]> }> {
    const channelsByVariant = new Map<string, StockViewChannel[]>();
    if (variantIds.length === 0) return { status: 'ok', channelsByVariant };

    let connections: Map<string, { name: string; platformType: string }>;
    try {
      connections = await this.listChannelConnections();
    } catch (error) {
      this.logger.error(
        'stock_view_channel_discovery_failed - reporting channels unavailable',
        (error as Error).stack
      );
      return { status: 'unavailable', channelsByVariant };
    }

    let observed: Awaited<ReturnType<IOfferCommercialReadService['getObservedQuantities']>> = [];
    let observedReadable = true;
    try {
      observed = await this.commercial.getObservedQuantities(variantIds);
    } catch (error) {
      observedReadable = false;
      this.logger.error(
        'stock_view_channel_snapshot_read_failed - "channel shows" reported as not seen',
        (error as Error).stack
      );
    }
    const observedByKey = new Map(
      observed.map((o) => [`${o.internalVariantId}:${o.connectionId}`, o])
    );
    const atpByVariant = new Map(views.map((v) => [v.productVariantId, v.availableToPromise]));

    let partial = !observedReadable;
    for (const [connectionId, connection] of connections) {
      try {
        const published = new Set(
          await this.publishedVariants.getPublishedVariantIds(connectionId, variantIds)
        );
        if (published.size === 0) continue;
        const publishedIds = variantIds.filter((id) => published.has(id));

        const rule = await this.readRule(connectionId);

        // Unknown ATP never reaches the Controls: it stays unknown here, so a
        // number is never invented for a variant OpenLinker cannot promise.
        const known = publishedIds.filter((id) => atpByVariant.get(id) !== null);
        const controlled = known.length
          ? await this.availability.applyPublishControlsBatch({
              quantities: known.map((id) => atpByVariant.get(id) ?? 0),
              scope: { kind: 'channel', connectionId },
            })
          : [];
        const willPublishByVariant = new Map(known.map((id, i) => [id, controlled[i]]));

        for (const variantId of publishedIds) {
          const controlledAnswer = willPublishByVariant.get(variantId);
          const seen = observedByKey.get(`${variantId}:${connectionId}`);
          const list = channelsByVariant.get(variantId) ?? [];
          list.push({
            connectionId,
            connectionName: connection.name,
            platformType: connection.platformType,
            rule,
            willPublish: controlledAnswer
              ? { quantity: controlledAnswer.quantity, provenance: controlledAnswer.provenance }
              : { quantity: null, provenance: 'unknown' },
            channelShows: {
              quantity: seen?.availableQuantity ?? null,
              observedAt: seen?.observedAt ?? null,
            },
          });
          channelsByVariant.set(variantId, list);
        }
      } catch (error) {
        partial = true;
        this.logger.error(
          `stock_view_channel_read_failed connection=${connectionId} - channel omitted`,
          (error as Error).stack
        );
      }
    }

    return { status: partial ? 'partial' : 'ok', channelsByVariant };
  }

  private async listChannelConnections(): Promise<
    Map<string, { name: string; platformType: string }>
  > {
    const lists = await Promise.all(
      CHANNEL_CAPABILITIES.map((capability) =>
        this.integrations.listCapabilityAdapters<unknown>({ capability, lazy: true })
      )
    );
    const connections = new Map<string, { name: string; platformType: string }>();
    for (const entry of lists.flat()) {
      if (!connections.has(entry.connectionId)) {
        connections.set(entry.connectionId, {
          name: entry.connection.name,
          platformType: entry.connection.platformType,
        });
      }
    }
    return connections;
  }

  private async readRule(connectionId: string): Promise<StockViewChannelRule | null> {
    try {
      const controls = await this.availability.getAppliedControls({
        kind: 'channel',
        connectionId,
      });
      return { stockSafetyBuffer: controls.buffer, stockZeroThreshold: controls.zeroThreshold };
    } catch (error) {
      this.logger.warn(
        `stock_view_rule_read_failed connection=${connectionId}: ${(error as Error).message}`
      );
      return null;
    }
  }

  private async resolveLocationNames(
    views: readonly VariantStockView[]
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        views.flatMap((v) =>
          v.positions.map((p) => p.locationId).filter((id): id is string => id !== null)
        )
      ),
    ];
    const names = new Map<string, string>();
    if (ids.length === 0) return names;
    try {
      for (const location of await this.locations.getLocationsByIds(ids)) {
        names.set(location.id, location.name);
      }
    } catch (error) {
      this.logger.warn(`stock_view_location_names_failed: ${(error as Error).message}`);
    }
    return names;
  }

  private async resolveSourceConnectionNames(
    views: readonly VariantStockView[]
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        views.flatMap((v) =>
          v.positions
            .map((p) => p.sourceConnectionId)
            .filter((id): id is string => id !== null && id !== LEGACY_SOURCE_CONNECTION_ID)
        )
      ),
    ];
    const names = new Map<string, string>();
    for (let i = 0; i < ids.length; i += NAME_LOOKUP_CONCURRENCY) {
      await Promise.all(
        ids.slice(i, i + NAME_LOOKUP_CONCURRENCY).map(async (id) => {
          try {
            names.set(id, (await this.connectionPort.get(id)).name);
          } catch {
            // A deleted connection reports no name; the id is still shown.
          }
        })
      );
    }
    return names;
  }

  private async resolveOrderNumbers(
    views: readonly VariantStockView[]
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(views.flatMap((v) => (v.holds ?? []).map((h) => h.orderRecordId))),
    ];
    const numbers = new Map<string, string>();
    if (ids.length === 0) return numbers;
    try {
      for (const record of await this.orderRecords.findByIds(ids)) {
        const summary = buildOrderSummary(record);
        if (summary?.orderNumber) numbers.set(record.internalOrderId, summary.orderNumber);
      }
    } catch (error) {
      this.logger.warn(`stock_view_order_numbers_failed: ${(error as Error).message}`);
    }
    return numbers;
  }
}
