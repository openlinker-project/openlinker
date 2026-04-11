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
  MarketplaceOfferFeedInput,
  MarketplaceOfferFeedOutput,
  UpdateOfferQuantityCommand,
  UpdateOfferFieldsCommand,
} from '@openlinker/core/integrations';
import type { IncomingOrder } from '@openlinker/core/orders';
import { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CustomerIdentityResolverPort } from '@openlinker/core/customers';
import { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import {
  AllegroCheckoutForm,
  AllegroOrderEventsResponse,
  AllegroOfferQuantityChangeCommandResponse,
  AllegroCategoryParametersResponse,
  AllegroOfferParameter,
  AllegroProductOffer,
  AllegroOffersResponse,
  AllegroOfferEventsResponse,
  AllegroOfferFieldsPatchBody,
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
   * List incremental marketplace offer events (Allegro).
   *
   * Uses Allegro offer events journal with cursor-based pagination.
   */
  async listOfferEvents(input: MarketplaceOfferFeedInput): Promise<MarketplaceOfferFeedOutput> {
    this.logger.debug(
      `Listing Allegro offer events (connection: ${this.connectionId}, fromCursor: ${input.cursor || 'none'}, limit: ${input.limit})`,
    );

    try {
      const queryParams: Record<string, string | number> = {};
      if (input.cursor) {
        queryParams.from = input.cursor;
      }
      queryParams.limit = input.limit;

      const response = await this.httpClient.get<AllegroOfferEventsResponse>('/sale/offer-events', {
        queryParams,
      });

      const events = response.data.offerEvents || [];
      const nextCursor =
        response.data.lastEventId ||
        (events.length > 0 ? events[events.length - 1]?.id : input.cursor || null);

      this.logger.debug(
        `Fetched ${events.length} offer events (connection: ${this.connectionId}, nextCursor: ${nextCursor || 'none'})`,
      );

      const eventMap = new Map<string, (typeof events)[number]>();
      for (const event of events) {
        eventMap.set(event.offer.id, event);
      }

      const offers = Array.from(eventMap.values()).map((event) => ({
        id: event.offer.id,
        external: event.offer.external?.id ? { id: event.offer.external.id } : undefined,
      }));

      return {
        items: await this.buildOfferFeedItems(offers),
        nextCursor,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list Allegro offer events (connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * List marketplace offers (Allegro).
   *
   * Uses offset-based pagination. Cursor is treated as an opaque offset string.
   */
  async listOffers(input: MarketplaceOfferFeedInput): Promise<MarketplaceOfferFeedOutput> {
    const offset = this.parseOffset(input.cursor);

    this.logger.debug(
      `Listing Allegro offers (connection: ${this.connectionId}, offset: ${offset}, limit: ${input.limit})`,
    );

    try {
      const response = await this.httpClient.get<AllegroOffersResponse>('/sale/offers', {
        queryParams: {
          limit: input.limit,
          offset,
        },
      });

      const offers = response.data.offers ?? [];
      this.logger.debug(
        `Received Allegro offers (connection: ${this.connectionId}, offers: ${offers.length}, total: ${response.data.totalCount})`,
      );
      const nextOffset = offset + offers.length;
      const nextCursor = nextOffset < response.data.totalCount ? String(nextOffset) : null;

      return {
        items: await this.buildOfferFeedItems(offers),
        nextCursor,
      };
    } catch (error) {
      this.logger.error(
        `Failed to list Allegro offers (connection: ${this.connectionId}): ${(error as Error).message}`,
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

  private parseOffset(cursor?: string | null): number {
    if (!cursor) {
      return 0;
    }
    const parsed = Number.parseInt(cursor, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  private async buildOfferFeedItems(
    offers: AllegroOffersResponse['offers'],
  ): Promise<MarketplaceOfferFeedOutput['items']> {
    const items: MarketplaceOfferFeedOutput['items'] = [];

    for (const offer of offers) {
      if (await this.isOfferMapped(offer.id)) {
        this.logger.debug(
          `Skipping Allegro offer ${offer.id} (connection: ${this.connectionId}) - already mapped`,
        );
        continue;
      }

      try {
        const identifiers = await this.fetchOfferIdentifiers(offer.id, offer.category?.id);
        items.push({
          offerId: offer.id,
          externalRef: offer.external?.id ?? null,
          sku: identifiers.sku,
          ean: identifiers.ean,
          gtin: identifiers.gtin,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to resolve identifiers for offer ${offer.id} (connection: ${this.connectionId}): ${(error as Error).message}`,
        );
        items.push({
          offerId: offer.id,
          externalRef: offer.external?.id ?? null,
        });
      }
    }

    return items;
  }

  private async isOfferMapped(offerId: string): Promise<boolean> {
    try {
      const internalId = await this.identifierMapping.getInternalId(
        'Offer',
        offerId,
        this.connectionId,
      );
      return internalId !== null;
    } catch (error) {
      this.logger.warn(
        `Failed to check existing offer mapping for ${offerId} (connection: ${this.connectionId}): ${(error as Error).message}`,
      );
      return false;
    }
  }

  private async fetchOfferIdentifiers(
    offerId: string,
    categoryId?: string,
  ): Promise<{ sku: string | null; ean: string | null; gtin: string | null }> {
    const response = await this.httpClient.get<AllegroProductOffer>(
      `/sale/product-offers/${offerId}`,
    );

    const offer = response.data;
    const resolvedCategoryId = categoryId ?? offer.category?.id ?? null;

    let eanIds: Set<string> = new Set();
    let gtinIds: Set<string> = new Set();

    if (resolvedCategoryId) {
      const categoryParamsResponse = await this.httpClient.get<AllegroCategoryParametersResponse>(
        `/sale/categories/${resolvedCategoryId}/parameters`,
      );
      const { eanIds: resolvedEanIds, gtinIds: resolvedGtinIds } =
        this.findIdentifierParameterIds(categoryParamsResponse.data.parameters);
      eanIds = resolvedEanIds;
      gtinIds = resolvedGtinIds;
    }

    const offerParams = offer.parameters ?? [];
    const productParams = offer.productSet?.flatMap((item) => item.product?.parameters ?? []) ?? [];
    const allParams = [...offerParams, ...productParams];

    const eanValues = this.extractIdentifierValues(allParams, eanIds, /ean/i);
    const gtinValues = this.extractIdentifierValues(allParams, gtinIds, /gtin/i);

    return {
      sku: null,
      ean: this.pickSingleValue(eanValues),
      gtin: this.pickSingleValue(gtinValues),
    };
  }

  private findIdentifierParameterIds(
    parameters: Array<{ id: string; name: string }>,
  ): { eanIds: Set<string>; gtinIds: Set<string> } {
    const eanIds = new Set<string>();
    const gtinIds = new Set<string>();

    for (const param of parameters) {
      const name = param.name.toLowerCase();
      if (name.includes('ean')) {
        eanIds.add(param.id);
      }
      if (name.includes('gtin')) {
        gtinIds.add(param.id);
      }
    }

    return { eanIds, gtinIds };
  }

  private extractIdentifierValues(
    parameters: AllegroOfferParameter[],
    idFilter: Set<string>,
    nameMatcher: RegExp,
  ): string[] {
    const values: string[] = [];

    for (const param of parameters) {
      const matchesId = idFilter.size > 0 && idFilter.has(param.id);
      const matchesName = idFilter.size === 0 && !!param.name && nameMatcher.test(param.name);

      if (!matchesId && !matchesName) {
        continue;
      }

      for (const value of param.values ?? []) {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          values.push(trimmed);
        }
      }
    }

    return values;
  }

  private pickSingleValue(values: string[]): string | null {
    const unique = Array.from(new Set(values));
    if (unique.length !== 1) {
      return null;
    }
    return unique[0];
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

  /**
   * Update offer fields (price, title, description) via Allegro PATCH.
   *
   * Partial update semantics: only fields present in cmd.fields are included
   * in the Allegro request payload. Uses PATCH /sale/product-offers/{offerId}.
   */
  async updateOfferFields(cmd: UpdateOfferFieldsCommand): Promise<void> {
    this.logger.debug(
      `Updating Allegro offer fields: offerId=${cmd.externalOfferId} (connection: ${this.connectionId}, fields=${Object.keys(cmd.fields).join(',')})`,
    );

    // Build partial PATCH payload — only include keys that are present
    const body: AllegroOfferFieldsPatchBody = {};

    if (cmd.fields.price !== undefined) {
      body.sellingMode = {
        price: {
          amount: cmd.fields.price.amount,
          currency: cmd.fields.price.currency,
        },
      };
    }

    if (cmd.fields.title !== undefined) {
      body.name = cmd.fields.title;
    }

    if (cmd.fields.description !== undefined) {
      body.description = {
        sections: cmd.fields.description.sections.map((section) => ({
          items: section.items.map((item) => ({
            type: item.type,
            content: item.content,
          })),
        })),
      };
    }

    if (Object.keys(body).length === 0) {
      this.logger.warn(
        `updateOfferFields called with empty fields for offerId=${cmd.externalOfferId} — skipping`,
      );
      return;
    }

    try {
      await this.httpClient.patch<void>(
        `/sale/product-offers/${cmd.externalOfferId}`,
        body,
      );

      this.logger.debug(
        `Allegro offer fields updated: offerId=${cmd.externalOfferId} (connection: ${this.connectionId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update Allegro offer fields (offerId: ${cmd.externalOfferId}, connection: ${this.connectionId}): ${(error as Error).message}`,
        error,
      );
      throw error;
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

