/**
 * Allegro Marketplace Adapter
 *
 * Adapter implementing MarketplaceIntegrationPort for Allegro. Handles order
 * ingestion from Allegro event journal and offer quantity updates via Allegro
 * command pattern.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {MarketplaceIntegrationPort}
 */
import { MarketplaceIntegrationPort } from '@openlinker/core/listings';
import {
  MarketplaceOrderFeedResponse,
  UpdateOfferQuantityRequest,
  UpdateOfferQuantityResult,
  OfferQuantityUpdateStatusValues,
} from '@openlinker/core/listings';
import { Order } from '@openlinker/core/orders';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import { AllegroOrderMapper, AllegroCheckoutForm } from '../mappers/allegro-order.mapper';
import {
  AllegroOrderEventsResponse,
  AllegroOfferQuantityChangeCommandResponse,
} from '../../domain/types/allegro-api.types';
import { Logger } from '@openlinker/shared/logging';
import { createHash } from 'crypto';

/**
 * Allegro Marketplace Adapter
 *
 * Adapter for Allegro marketplace operations (order ingestion and offer quantity updates).
 */
export class AllegroMarketplaceAdapter implements MarketplaceIntegrationPort {
  private readonly logger = new Logger(AllegroMarketplaceAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IAllegroHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    _connection: Connection,
  ) {
    // Connection is stored for potential future use but not currently accessed
    void _connection;
  }

  /**
   * Get incremental marketplace orders
   *
   * Fetches order events from Allegro event journal using cursor-based pagination.
   * Returns order references (eventId, checkoutFormId) that can be hydrated into
   * full orders via getOrderByCheckoutFormId.
   */
  async getOrders(params: { cursor?: string; limit?: number }): Promise<MarketplaceOrderFeedResponse> {
    this.logger.debug(
      `Fetching Allegro orders (connection: ${this.connectionId}, cursor: ${params.cursor || 'none'}, limit: ${params.limit || 'default'})`,
    );

    try {
      // Build query parameters for /order/events endpoint
      const queryParams: Record<string, string | number> = {};
      if (params.cursor) {
        queryParams.from = params.cursor; // Allegro uses 'from' parameter for cursor
      }
      if (params.limit) {
        queryParams.limit = params.limit;
      }

      // Fetch order events from Allegro
      const response = await this.httpClient.get<AllegroOrderEventsResponse>('/order/events', {
        queryParams,
      });

      const events = response.data.events || [];
      const nextCursor = response.data.lastEventId || events[events.length - 1]?.id;

      this.logger.debug(
        `Fetched ${events.length} order events (connection: ${this.connectionId}, nextCursor: ${nextCursor})`,
      );

      // Map events to marketplace feed items
      const mapper = new AllegroOrderMapper(this.connectionId, this.identifierMapping);
      const items = mapper.toMarketplaceFeedItems(events);

      return {
        items,
        nextCursor: nextCursor || '',
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch Allegro orders (connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get a full order by checkout form ID
   *
   * Fetches full order details from Allegro and maps to unified Order schema
   * with internal OpenLinker IDs.
   */
  async getOrderByCheckoutFormId(checkoutFormId: string): Promise<Order> {
    this.logger.debug(
      `Fetching Allegro order by checkout form ID: ${checkoutFormId} (connection: ${this.connectionId})`,
    );

    try {
      // Fetch checkout form from Allegro
      const response = await this.httpClient.get<AllegroCheckoutForm>(
        `/order/checkout-forms/${checkoutFormId}`,
      );

      // Map to unified Order schema with internal IDs
      const mapper = new AllegroOrderMapper(this.connectionId, this.identifierMapping);
      const order = await mapper.toUnifiedOrder(response.data);

      this.logger.debug(
        `Mapped Allegro order ${checkoutFormId} to unified order ${order.id} (connection: ${this.connectionId})`,
      );

      return order;
    } catch (error) {
      this.logger.error(
        `Failed to fetch Allegro order ${checkoutFormId} (connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update marketplace offer quantity
   *
   * Issues an Allegro offer quantity change command. Uses idempotency key
   * to derive a deterministic commandId for deduplication.
   */
  async updateOfferQuantity(request: UpdateOfferQuantityRequest): Promise<UpdateOfferQuantityResult> {
    this.logger.debug(
      `Updating Allegro offer quantity: offerId=${request.offerId}, quantity=${request.quantity} (connection: ${this.connectionId}, idempotencyKey: ${request.idempotencyKey})`,
    );

    try {
      // Generate deterministic commandId from idempotency key (or use UUID if not provided)
      // Allegro requires commandId to be a UUID, so we'll generate one deterministically from idempotency key
      const commandId = this.generateCommandIdFromIdempotencyKey(request.idempotencyKey);

      // Build command request body (convert to plain object for HTTP client)
      const commandBody: Record<string, unknown> = {
        offerId: request.offerId,
        quantityChange: {
          changeType: 'FIXED',
          value: request.quantity,
        },
      };

      // Submit command to Allegro
      const response = await this.httpClient.put<AllegroOfferQuantityChangeCommandResponse>(
        `/sale/offer-quantity-change-commands/${commandId}`,
        commandBody,
      );

      // Map Allegro status to unified status
      const status = this.mapAllegroCommandStatus(response.data.status);

      this.logger.debug(
        `Allegro offer quantity command submitted: commandId=${response.data.id}, status=${status} (connection: ${this.connectionId})`,
      );

      return {
        commandId: response.data.id,
        status,
      };
    } catch (error) {
      this.logger.error(
        `Failed to update Allegro offer quantity (offerId: ${request.offerId}, connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Generate deterministic commandId from idempotency key
   *
   * Allegro requires commandId to be a UUID. We generate a deterministic UUID
   * from the idempotency key using SHA-256 hash and format as UUID v4.
   */
  private generateCommandIdFromIdempotencyKey(idempotencyKey: string): string {
    // Use SHA-256 hash for deterministic UUID generation
    const hash = createHash('sha256').update(idempotencyKey).digest('hex');
    // Format as UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // Take first 32 hex characters and format as UUID
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(12, 15)}-${((parseInt(hash.substring(15, 16), 16) & 0x3) | 0x8).toString(16)}${hash.substring(16, 19)}-${hash.substring(19, 31)}`;
  }

  /**
   * Map Allegro command status to unified status
   */
  private mapAllegroCommandStatus(allegroStatus: 'QUEUED' | 'ACCEPTED' | 'REJECTED'): (typeof OfferQuantityUpdateStatusValues)[number] {
    switch (allegroStatus) {
      case 'QUEUED':
        return 'queued';
      case 'ACCEPTED':
        return 'accepted';
      case 'REJECTED':
        return 'rejected';
      default:
        // TypeScript knows this is unreachable, but we handle it for runtime safety
        const status = allegroStatus as string;
        this.logger.warn(`Unknown Allegro command status: ${status}, defaulting to 'queued'`);
        return 'queued';
    }
  }
}

