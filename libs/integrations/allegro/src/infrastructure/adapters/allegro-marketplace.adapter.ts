/**
 * Allegro Marketplace Adapter
 *
 * Adapter implementing the canonical MarketplacePort for Allegro. Handles order
 * ingestion from Allegro event journal and offer quantity updates via Allegro
 * command pattern.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {MarketplacePort}
 */
import {
  MarketplacePort,
  MarketplaceOrderFeedInput,
  MarketplaceOrderFeedOutput,
  MarketplaceOrderEventType,
  UpdateOfferQuantityCommand,
} from '@openlinker/core/integrations';
import type { IncomingOrder } from '@openlinker/core/orders';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CustomerIdentityResolverPort } from '@openlinker/core/customers';
import { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import { AllegroCheckoutForm } from '../mappers/allegro-order.mapper';
import {
  AllegroOrderEventsResponse,
  AllegroOfferQuantityChangeCommandResponse,
} from '../../domain/types/allegro-api.types';
import { Logger } from '@openlinker/shared/logging';
import { createHash } from 'crypto';
import {
  AllegroQuantityCommandRepositoryPort,
  AllegroQuantityCommand,
} from '../../index';

type MarketplaceOrderFeedItem = MarketplaceOrderFeedOutput['items'][number];

/**
 * Allegro Marketplace Adapter
 *
 * Adapter for Allegro marketplace operations (order ingestion and offer quantity updates).
 */
export class AllegroMarketplaceAdapter implements MarketplacePort {
  private readonly logger = new Logger(AllegroMarketplaceAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IAllegroHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    _connection: Connection,
    private readonly customerIdentityResolver?: CustomerIdentityResolverPort,
    private readonly commandRepository?: AllegroQuantityCommandRepositoryPort,
  ) {
    // Connection is stored for potential future use but not currently accessed
    void _connection;
    // Keep deps in constructor for backward compatibility with factory, but do not use
    // identifier mapping or identity resolution in IncomingOrder (external-only contract).
    void this.identifierMapping;
    void this.customerIdentityResolver;
  }

  /**
   * List incremental marketplace order feed items (event journal).
   *
   * Fetches order events from Allegro event journal using cursor-based pagination.
   */
  async listOrderFeed(input: MarketplaceOrderFeedInput): Promise<MarketplaceOrderFeedOutput> {
    this.logger.debug(
      `Listing Allegro order feed (connection: ${this.connectionId}, fromCursor: ${input.fromCursor || 'none'}, limit: ${input.limit})`,
    );

    try {
      // Build query parameters for /order/events endpoint
      const queryParams: Record<string, string | number> = {};
      if (input.fromCursor) {
        queryParams.from = input.fromCursor; // Allegro uses 'from' parameter for cursor
      }
      queryParams.limit = input.limit;

      // Fetch order events from Allegro
      const response = await this.httpClient.get<AllegroOrderEventsResponse>('/order/events', {
        queryParams,
      });

      // Log raw response for debugging
      this.logger.debug(
        `Allegro /order/events raw response (connection: ${this.connectionId}): ${JSON.stringify(response.data)}`,
      );

      const events = response.data.events || [];
      
      // Determine nextCursor:
      // 1. Use lastEventId from API if provided (most reliable)
      // 2. Fall back to last event's ID if events exist
      // 3. If no events and no lastEventId, keep the current cursor (return it as nextCursor)
      //    This prevents the cursor from getting stuck when Allegro returns empty results
      const nextCursor = response.data.lastEventId || 
                        (events.length > 0 ? events[events.length - 1]?.id : input.fromCursor || null);

      this.logger.debug(
        `Fetched ${events.length} order events (connection: ${this.connectionId}, nextCursor: ${nextCursor || 'none'})`,
      );

      // Deduplicate by checkoutFormId, keeping the latest event (highest ID)
      const eventMap = new Map<string, (typeof events)[number]>();
      for (const event of events) {
        const checkoutFormId = event.order.checkoutForm.id;
        const existing = eventMap.get(checkoutFormId);
        if (!existing || event.id > existing.id) {
          eventMap.set(checkoutFormId, event);
        }
      }

      const items: MarketplaceOrderFeedItem[] = Array.from(eventMap.values())
        .map((event) => {
          const externalOrderId = event.order.checkoutForm.id;
          const occurredAt = event.occurredAt;
          const eventType = this.mapAllegroEventType(event.type);

          return {
            externalOrderId,
            eventType,
            occurredAt,
            eventKey: event.id,
            eventId: event.id,
            raw: { type: event.type },
          };
        })
        .filter((i) => !input.eventTypes || input.eventTypes.includes(i.eventType));

      return {
        items,
        nextCursor,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list Allegro order feed (connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get a full order by marketplace-native order id (Allegro checkout form id).
   *
   * Returns IncomingOrder DTO (integration-facing). Core maps it to canonical models.
   */
  async getOrder(input: { externalOrderId: string }): Promise<IncomingOrder> {
    const checkoutFormId = input.externalOrderId;
    this.logger.debug(
      `Fetching Allegro order by checkout form ID: ${checkoutFormId} (connection: ${this.connectionId})`,
    );

    try {
      // Fetch checkout form from Allegro
      const response = await this.httpClient.get<AllegroCheckoutForm>(
        `/order/checkout-forms/${checkoutFormId}`,
      );

      const checkoutForm = response.data;

      const status = checkoutForm.payment.finishedAt ? 'processing' : 'pending';
      const createdAt = checkoutForm.createdAt ?? new Date().toISOString();
      const updatedAt = checkoutForm.updatedAt ?? createdAt;

      return {
        externalOrderId: checkoutFormId,
        orderNumber: checkoutFormId,
        status,
        customerExternalId: checkoutForm.buyer.id,
        items: checkoutForm.lineItems.map((lineItem) => ({
          id: lineItem.id,
          productRef: { type: 'offer', externalId: lineItem.offer.id },
          quantity: lineItem.quantity,
          price: Number.parseFloat(lineItem.price.amount),
          sku: lineItem.offer.id,
        })),
        totals: {
          subtotal: Number.parseFloat(checkoutForm.summary.totalToPay.amount),
          tax: 0,
          shipping: 0,
          total: Number.parseFloat(checkoutForm.summary.totalToPay.amount),
          currency: checkoutForm.summary.totalToPay.currency,
        },
        shippingAddress: checkoutForm.buyer.address
          ? {
              firstName: checkoutForm.buyer.firstName,
              lastName: checkoutForm.buyer.lastName,
              address1: checkoutForm.buyer.address.street ?? '',
              city: checkoutForm.buyer.address.city ?? '',
              postalCode: checkoutForm.buyer.address.zipCode ?? '',
              country: checkoutForm.buyer.address.countryCode ?? '',
              phone: checkoutForm.buyer.phoneNumber,
            }
          : undefined,
        billingAddress: undefined,
        createdAt,
        updatedAt,
        metadata: {
          buyer: {
            email: checkoutForm.buyer.email,
            login: checkoutForm.buyer.login,
          },
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch Allegro order ${checkoutFormId} (connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Update marketplace offer quantity.
   *
   * Issues an Allegro offer quantity change command. Uses idempotency key
   * to derive a deterministic commandId for deduplication.
   */
  async updateOfferQuantity(cmd: UpdateOfferQuantityCommand): Promise<void> {
    if (!cmd.idempotencyKey) {
      throw new Error('idempotencyKey is required for Allegro offer quantity updates');
    }

    this.logger.debug(
      `Updating Allegro offer quantity: offerId=${cmd.offerId}, quantity=${cmd.quantity} (connection: ${this.connectionId}, idempotencyKey: ${cmd.idempotencyKey})`,
    );

    try {
      // Generate deterministic commandId from idempotency key (or use UUID if not provided)
      // Allegro requires commandId to be a UUID, so we'll generate one deterministically from idempotency key
      const commandId = this.generateCommandIdFromIdempotencyKey(cmd.idempotencyKey);

      // Build command request body (convert to plain object for HTTP client)
      const commandBody: Record<string, unknown> = {
        offerId: cmd.offerId,
        quantityChange: {
          changeType: 'FIXED',
          value: cmd.quantity,
        },
      };

      // Submit command to Allegro
      const response = await this.httpClient.put<AllegroOfferQuantityChangeCommandResponse>(
        `/sale/offer-quantity-change-commands/${commandId}`,
        commandBody,
      );

      // Persist command status for observability (optional)
      try {
        if (this.commandRepository) {
          const status = this.mapAllegroCommandStatus(response.data.status);
          const command = AllegroQuantityCommand.create(
            response.data.id,
            this.connectionId,
            cmd.offerId,
            cmd.quantity,
            status,
          );
          await this.commandRepository.create(command);
        }
      } catch (persistError) {
        // Observability persistence must not fail the update itself.
        this.logger.warn(
          `Failed to persist offer quantity command status (commandId: ${response.data.id}): ${(persistError as Error).message}`,
        );
      }

      this.logger.debug(
        `Allegro offer quantity command submitted: commandId=${response.data.id} (connection: ${this.connectionId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update Allegro offer quantity (offerId: ${cmd.offerId}, connection: ${this.connectionId}): ${(error as Error).message}`,
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
  private mapAllegroCommandStatus(allegroStatus: 'QUEUED' | 'ACCEPTED' | 'REJECTED'): 'queued' | 'accepted' | 'rejected' {
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

  private mapAllegroEventType(type: string): MarketplaceOrderEventType {
    const t = type.toUpperCase();
    if (t.includes('CANCEL')) return 'cancelled';
    if (t.includes('PAID')) return 'paid';
    if (t.includes('BOUGHT')) return 'created';
    return 'updated';
  }
}

