/**
 * Allegro Order Mapper
 *
 * Maps Allegro API order data to OpenLinker unified Order schema.
 * Handles transformation of Allegro checkout form structure to unified Order
 * with internal IDs (via IdentifierMappingService).
 *
 * @module libs/integrations/allegro/src/infrastructure/mappers
 */
import { Order, OrderItem, OrderTotals, Address } from '@openlinker/core/orders';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

/**
 * Allegro checkout form (from /order/checkout-forms/{id})
 */
export interface AllegroCheckoutForm {
  id: string;
  messageToSeller?: string;
  buyer: {
    id: string;
    email?: string;
    login?: string;
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    address?: {
      street?: string;
      city?: string;
      zipCode?: string;
      countryCode?: string;
    };
  };
  payment: {
    type: string;
    provider?: string;
    finishedAt?: string;
    paidAmount?: {
      amount: string;
      currency: string;
    };
  };
  lineItems: Array<{
    id: string;
    offer: {
      id: string;
      name: string;
    };
    quantity: number;
    price: {
      amount: string;
      currency: string;
    };
    boughtAt?: string;
  }>;
  summary: {
    totalToPay: {
      amount: string;
      currency: string;
    };
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Allegro order event (from /order/events)
 */
export interface AllegroOrderEvent {
  id: string;
  order: {
    id: string;
    checkoutForm: {
      id: string;
    };
  };
  occurredAt: string;
  type: string;
}

/**
 * Allegro Order Mapper
 *
 * Maps Allegro API responses to OpenLinker unified Order schema.
 */
export class AllegroOrderMapper {
  constructor(
    private readonly connectionId: string,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly logger: Logger,
  ) {}

  /**
   * Map Allegro checkout form to unified Order
   *
   * Converts Allegro checkout form structure to OpenLinker Order with internal IDs.
   * Uses IdentifierMappingService to resolve internal IDs for customer, products, and order.
   * If internalCustomerId is provided (from CustomerIdentityResolver), uses it directly.
   * Otherwise, falls back to identifier mapping via IdentifierMappingService.
   *
   * @param checkoutForm - Allegro checkout form data
   * @param internalCustomerId - Optional pre-resolved internal customer ID (from CustomerIdentityResolver).
   *   If provided, uses this ID directly. Otherwise, falls back to identifier mapping via IdentifierMappingService.
   */
  async toUnifiedOrder(checkoutForm: AllegroCheckoutForm, internalCustomerId?: string): Promise<Order> {
    // Map customer ID (external Allegro buyer ID -> internal OpenLinker customer ID)
    // Use provided internalCustomerId if available (from CustomerIdentityResolver), otherwise fall back to identifier mapping
    let customerId: string;
    if (internalCustomerId) {
      customerId = internalCustomerId;
    } else {
      try {
        customerId = await this.identifierMapping.getOrCreateInternalId(
          'Customer',
          checkoutForm.buyer.id,
          this.connectionId,
          {
            metadata: {
              email: checkoutForm.buyer.email,
              login: checkoutForm.buyer.login,
            },
          },
        );
      } catch (error) {
        throw new Error(
          `Failed to map customer ID for Allegro buyer ${checkoutForm.buyer.id} (checkout form: ${checkoutForm.id}): ${(error as Error).message}`,
        );
      }
    }

    // Map order items with product ID mapping
    const items: OrderItem[] = await Promise.all(
      checkoutForm.lineItems.map(async (lineItem) => {
        // Map product ID (external Allegro offer ID -> internal OpenLinker product ID)
        let productId: string;
        try {
          this.logger.debug(`I'm here 6 xddddd`);
          this.logger.debug(`lineItem.offer.id: ${lineItem.offer.id}`);
          this.logger.debug(`this.connectionId: ${this.connectionId}`);
          productId = await this.identifierMapping.getOrCreateInternalId(
            'Product',
            lineItem.offer.id,
            this.connectionId,
            {
              metadata: {
                name: lineItem.offer.name,
              },
            },
          );
        } catch (error) {
          throw new Error(
            `Failed to map product ID for Allegro offer ${lineItem.offer.id} (checkout form: ${checkoutForm.id}): ${(error as Error).message}`,
          );
        }

        return {
          id: lineItem.id, // Keep Allegro line item ID as-is (or map if needed)
          productId,
          quantity: lineItem.quantity,
          price: parseFloat(lineItem.price.amount),
          sku: lineItem.offer.id, // Use offer ID as SKU for now
        };
      }),
    );

    // Map order ID (external Allegro checkout form ID -> internal OpenLinker order ID)
    let orderId: string;
    try {
      orderId = await this.identifierMapping.getOrCreateInternalId(
        'Order',
        checkoutForm.id,
        this.connectionId,
        {
          metadata: {
            buyerId: checkoutForm.buyer.id,
            createdAt: checkoutForm.createdAt,
          },
        },
      );
    } catch (error) {
      throw new Error(
        `Failed to map order ID for Allegro checkout form ${checkoutForm.id}: ${(error as Error).message}`,
      );
    }

    // Map addresses
    const shippingAddress: Address | undefined = checkoutForm.buyer.address
      ? {
          firstName: checkoutForm.buyer.firstName,
          lastName: checkoutForm.buyer.lastName,
          address1: checkoutForm.buyer.address.street || '',
          city: checkoutForm.buyer.address.city || '',
          postalCode: checkoutForm.buyer.address.zipCode || '',
          country: checkoutForm.buyer.address.countryCode || '',
          phone: checkoutForm.buyer.phoneNumber,
        }
      : undefined;

    // Map totals
    const totalAmount = parseFloat(checkoutForm.summary.totalToPay.amount);
    const currency = checkoutForm.summary.totalToPay.currency;

    const totals: OrderTotals = {
      subtotal: totalAmount, // Allegro doesn't break down subtotal/tax/shipping in checkout form
      tax: 0, // Not available in Allegro checkout form
      shipping: 0, // Not available in Allegro checkout form
      total: totalAmount,
      currency,
    };

    // Determine order status from payment status
    const status = checkoutForm.payment.finishedAt ? 'processing' : 'pending';

    return {
      id: orderId,
      orderNumber: checkoutForm.id, // Use Allegro checkout form ID as order number
      status,
      customerId,
      items,
      totals,
      shippingAddress,
      billingAddress: shippingAddress, // Allegro uses same address for billing
      createdAt: checkoutForm.createdAt ? new Date(checkoutForm.createdAt) : new Date(),
      updatedAt: checkoutForm.updatedAt ? new Date(checkoutForm.updatedAt) : new Date(),
    };
  }

  /**
   * Map Allegro order events to marketplace feed items
   *
   * Converts Allegro order events to unified MarketplaceOrderFeedItem format.
   * Deduplicates events by checkoutFormId, keeping only the latest event for each order.
   * This prevents processing multiple events (FILLED_IN, BOUGHT, READY_FOR_PROCESSING)
   * for the same order, which would cause duplicate order creation attempts.
   */
  toMarketplaceFeedItems(events: AllegroOrderEvent[]): Array<{ eventId: string; checkoutFormId: string }> {
    // Deduplicate by checkoutFormId, keeping the latest event (highest event ID)
    // Events are typically returned in chronological order, but we sort by event ID
    // to ensure we get the latest one
    const eventMap = new Map<string, AllegroOrderEvent>();
    
    for (const event of events) {
      const checkoutFormId = event.order.checkoutForm.id;
      const existing = eventMap.get(checkoutFormId);
      
      // Keep the event with the highest ID (latest event)
      if (!existing || event.id > existing.id) {
        eventMap.set(checkoutFormId, event);
      }
    }
    
    // Convert to feed items
    return Array.from(eventMap.values()).map((event) => ({
      eventId: event.id,
      checkoutFormId: event.order.checkoutForm.id,
    }));
  }
}

