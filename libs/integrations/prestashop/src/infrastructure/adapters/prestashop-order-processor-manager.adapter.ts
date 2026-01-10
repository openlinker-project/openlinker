/**
 * PrestaShop Order Processor Manager Adapter
 *
 * Implements OrderProcessorManagerPort for PrestaShop WebService API. Handles
 * order creation in PrestaShop by mapping unified Order schema to PrestaShop
 * format and using IdentifierMappingService to resolve external IDs.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {OrderProcessorManagerPort}
 */
import { OrderProcessorManagerPort, OrderCreate, OrderRef } from '@openlinker/core/orders';
import { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { IPrestashopOrderMapper, PrestashopOrder } from '../mappers/prestashop.mapper.interface';
import { PrestashopResourceNotFoundException, PrestashopApiException } from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';

/**
 * PrestaShop Order Processor Manager Adapter
 *
 * Handles order creation in PrestaShop via WebService API.
 */
export class PrestashopOrderProcessorManagerAdapter implements OrderProcessorManagerPort {
  private readonly logger = new Logger(PrestashopOrderProcessorManagerAdapter.name);

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly orderMapper: IPrestashopOrderMapper,
    private readonly connection: Connection,
  ) {}

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    this.logger.log(
      `Creating PrestaShop order: orderNumber=${order.orderNumber || 'N/A'}, ` +
        `status=${order.status}, items=${order.items.length}, total=${order.totals.total} ${order.totals.currency}`,
    );

    try {
      // Step 1: Resolve customer external ID
      let externalCustomerId: string | number;
      if (order.customerId) {
        const externalIds = await this.identifierMapping.getExternalIds('Customer', order.customerId);
        const prestashopCustomerId = externalIds.find(
          (e: { connectionId: string }) => e.connectionId === this.connection.id,
        );

        if (!prestashopCustomerId) {
          throw new PrestashopApiException(
            `Customer not found in PrestaShop: ${order.customerId} (no external ID mapping for connection ${this.connection.id})`,
            undefined,
            undefined,
          );
        }

        externalCustomerId = prestashopCustomerId.externalId;
        this.logger.debug(`Resolved customer ID: ${order.customerId} → ${externalCustomerId}`);
      } else {
        // PrestaShop requires a customer ID. For MVP, we'll throw an error.
        // In future, we could create a guest customer or use a default customer.
        throw new PrestashopApiException(
          'Customer ID is required for PrestaShop order creation',
          undefined,
          undefined,
        );
      }

      // Step 2: Resolve product and variant external IDs
      const externalProductIds = new Map<string, string | number>();
      const externalVariantIds = new Map<string, string | number>();

      for (const item of order.items) {
        // Resolve product ID
        const productExternalIds = await this.identifierMapping.getExternalIds('Product', item.productId);
        const prestashopProductId = productExternalIds.find(
          (e: { connectionId: string }) => e.connectionId === this.connection.id,
        );

        if (!prestashopProductId) {
          throw new PrestashopApiException(
            `Product not found in PrestaShop: ${item.productId} (no external ID mapping for connection ${this.connection.id})`,
            undefined,
            undefined,
          );
        }

        externalProductIds.set(item.productId, prestashopProductId.externalId);

        // Resolve variant ID if present
        if (item.variantId) {
          // Note: PrestaShop uses "combinations" for variants, which are mapped as Product entities
          // with a product_attribute_id. For MVP, we'll try to find the combination ID.
          // This may need refinement based on how variants are stored in PrestaShop.
          const variantExternalIds = await this.identifierMapping.getExternalIds('Product', item.variantId);
          const prestashopVariantId = variantExternalIds.find(
            (e: { connectionId: string }) => e.connectionId === this.connection.id,
          );

          if (prestashopVariantId) {
            externalVariantIds.set(item.variantId, prestashopVariantId.externalId);
          }
          // If variant mapping not found, we'll use 0 (no variant) in the mapper
        }
      }

      this.logger.debug(
        `Resolved ${externalProductIds.size} product IDs and ${externalVariantIds.size} variant IDs`,
      );

      // Step 3: Map OrderCreate to PrestaShop format
      const prestashopOrderData = this.orderMapper.mapOrderCreate(
        order,
        externalCustomerId,
        externalProductIds,
        externalVariantIds,
      );

      // Step 4: Create order in PrestaShop
      this.logger.debug(`Submitting order creation request to PrestaShop`);
      const createdOrder = await this.httpClient.createResource<PrestashopOrder>('orders', prestashopOrderData);

      const externalOrderId = String(createdOrder.id);
      this.logger.log(`PrestaShop order created successfully: externalOrderId=${externalOrderId}`);

      // Step 5: Create identifier mapping for the new order
      // The order ID returned by PrestaShop is external, we need to map it to an internal ID
      // For order creation, we'll use the order number as the internal identifier if available,
      // or generate a new internal ID
      const internalOrderId = await this.identifierMapping.getOrCreateInternalId(
        'Order',
        externalOrderId,
        this.connection.id,
        {
          metadata: {
            orderNumber: order.orderNumber || createdOrder.reference,
            createdAt: new Date().toISOString(),
          },
        },
      );

      this.logger.log(
        `Order mapping created: externalOrderId=${externalOrderId}, internalOrderId=${internalOrderId}`,
      );

      // Step 6: Return order reference
      return {
        orderId: internalOrderId,
        orderNumber: createdOrder.reference || order.orderNumber || externalOrderId,
      };
    } catch (error) {
      if (error instanceof PrestashopResourceNotFoundException || error instanceof PrestashopApiException) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to create PrestaShop order: ${errorMessage}`, error);
      throw new PrestashopApiException(
        `Failed to create PrestaShop order: ${errorMessage}`,
        undefined,
        undefined,
      );
    }
  }
}

