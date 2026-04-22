/**
 * PrestaShop Order Processor Manager Adapter
 *
 * Implements OrderProcessorManagerPort for PrestaShop WebService API. Handles
 * order creation in PrestaShop by mapping unified Order schema to PrestaShop
 * format and using IdentifierMappingService to resolve external IDs.
 *
 * Idempotency contract: callers must pass the source-side internal order id in
 * `order.metadata.internalOrderId`. Step 0 uses it to short-circuit on retry,
 * and Step 6 writes the destination mapping under the same id so future retries
 * find it.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {OrderProcessorManagerPort}
 */
import { OrderProcessorManagerPort, OrderCreate, OrderRef } from '@openlinker/core/orders';
import {
  IdentifierMappingPort,
  Connection,
  MappingAlreadyExistsError,
  DuplicateIdentifierMappingError,
} from '@openlinker/core/identifier-mapping';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { IPrestashopOrderMapper, PrestashopOrder } from '../mappers/prestashop.mapper.interface';
import {
  PrestashopResourceNotFoundException,
  PrestashopApiException,
  PrestashopProvisioningException,
} from '@openlinker/integrations-prestashop';
import { Logger } from '@openlinker/shared/logging';
import { PrestashopCustomerProvisioner } from '../provisioners/prestashop-customer-provisioner';
import { PrestashopAddressProvisioner } from '../provisioners/prestashop-address-provisioner';
import { PrestashopCurrencyResolver } from '../provisioners/prestashop-currency-resolver';
import { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import { hashEmail } from '@openlinker/shared/config';

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
    private readonly customerProvisioner: PrestashopCustomerProvisioner,
    private readonly addressProvisioner: PrestashopAddressProvisioner,
    private readonly currencyResolver: PrestashopCurrencyResolver,
    private readonly customerProjectionRepository: CustomerProjectionRepositoryPort,
  ) {}

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    this.logger.log(
      `Creating PrestaShop order: orderNumber=${order.orderNumber || 'N/A'}, ` +
        `status=${order.status}, items=${order.items.length}, total=${order.totals.total} ${order.totals.currency}`,
    );

    this.logger.debug(`order: ${JSON.stringify(order)}`);

    try {
      // Step 0: Check if order already exists (idempotency check)
      // If we have an internal order ID in metadata, check if we've already created this order
      const metadataInternalOrderId = order.metadata?.internalOrderId as string | undefined;
      if (metadataInternalOrderId) {
        const existingExternalIds = await this.identifierMapping.getExternalIds('Order', metadataInternalOrderId);
        const existingPrestashopOrder = existingExternalIds.find(
          (e: { connectionId: string }) => e.connectionId === this.connection.id,
        );

        if (existingPrestashopOrder) {
          this.logger.log(
            `Order already exists in PrestaShop: internalOrderId=${metadataInternalOrderId}, externalOrderId=${existingPrestashopOrder.externalId}`,
          );
          // Return existing order reference
          // Note: We don't have the order number from the mapping, so we'll use the external ID
          // metadataInternalOrderId is guaranteed to be string here because of the if check above
          return {
            orderId: metadataInternalOrderId,
            orderNumber: order.orderNumber || String(existingPrestashopOrder.externalId),
          };
        }
      }

      // Step 1: Resolve or provision customer in PrestaShop
      let externalCustomerId: string | number;
      if (order.customerId) {
        const externalIds = await this.identifierMapping.getExternalIds('Customer', order.customerId);
        const prestashopCustomerId = externalIds.find(
          (e: { connectionId: string }) => e.connectionId === this.connection.id,
        );

        if (prestashopCustomerId) {
          // Mapping exists, use it
          externalCustomerId = prestashopCustomerId.externalId;
          this.logger.debug(`Resolved customer ID: ${order.customerId} → ${externalCustomerId}`);
        } else {
          // Mapping missing - provision guest customer
          this.logger.debug(
            `Customer mapping not found for ${order.customerId}, provisioning guest customer in PrestaShop`,
          );

          // Get customer email from projection
          const customerProjection = await this.customerProjectionRepository.findById(order.customerId);
          if (!customerProjection || !customerProjection.normalizedEmail) {
            throw new PrestashopApiException(
              `Cannot provision customer: customer projection not found or email missing for ${order.customerId}`,
              undefined,
              undefined,
            );
          }
          
          // Extract name from order addresses if available
          const firstName =
            order.shippingAddress?.firstName || order.billingAddress?.firstName || null;
          const lastName =
            order.shippingAddress?.lastName || order.billingAddress?.lastName || null;

          // Normalize email and compute hash for lock key
          const normalizedEmail = customerProjection.normalizedEmail;
          const emailHash = hashEmail(normalizedEmail);

          // Get connection config (already validated by factory)
          const connectionConfig = this.connection.config as unknown as PrestashopConnectionConfig;

          // Provision guest customer
          const provisionedCustomerId = await this.customerProvisioner.resolveOrCreateGuestCustomer(
            order.customerId,
            normalizedEmail,
            emailHash,
            firstName,
            lastName,
            this.connection.id,
            this.httpClient,
            connectionConfig,
            this.identifierMapping,
          );

          externalCustomerId = provisionedCustomerId;
          this.logger.log(
            `Provisioned guest customer in PrestaShop: ${order.customerId} → ${externalCustomerId}`,
          );
        }
      } else {
        // PrestaShop requires a customer ID. Customer should be resolved upstream by identity resolver.
        throw new PrestashopApiException(
          'Customer ID is required for PrestaShop order creation. ' +
            'Ensure customer identity is resolved before order creation.',
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
          const variantExternalIds = await this.identifierMapping.getExternalIds(
            'ProductVariant',
            item.variantId,
          );
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

      // Step 3: Resolve or provision addresses in PrestaShop
      let externalShippingAddressId: string | number | undefined;
      let externalBillingAddressId: string | number | undefined;

      // Get connection config (already validated by factory)
      const connectionConfig = this.connection.config as unknown as PrestashopConnectionConfig;

      if (order.shippingAddress && order.customerId) {
        externalShippingAddressId = await this.addressProvisioner.resolveOrCreateAddress(
          order.customerId,
          String(externalCustomerId),
          order.shippingAddress,
          'shipping',
          this.connection.id,
          this.httpClient,
          connectionConfig,
          this.customerProjectionRepository,
        );
        this.logger.debug(`Resolved shipping address ID: ${externalShippingAddressId}`);
      }

      if (order.billingAddress && order.customerId) {
        externalBillingAddressId = await this.addressProvisioner.resolveOrCreateAddress(
          order.customerId,
          String(externalCustomerId),
          order.billingAddress,
          'billing',
          this.connection.id,
          this.httpClient,
          connectionConfig,
          this.customerProjectionRepository,
        );
        this.logger.debug(`Resolved billing address ID: ${externalBillingAddressId}`);
      }

      // Step 4: Resolve currency ID
      const currencyCode = order.totals.currency || 'EUR'; // Default to EUR if not specified
      const externalCurrencyId = await this.currencyResolver.resolveCurrencyId(
        currencyCode,
        this.connection.id,
        this.httpClient,
      );
      this.logger.debug(`Resolved currency ID: ${currencyCode} → ${externalCurrencyId}`);

      // Step 5: Get language ID from connection config
      const config = this.connection.config as unknown as PrestashopConnectionConfig;
      // Support both preferredLanguageId (new) and langId (deprecated, backward compatibility)
      const configLangId: number | undefined = config.preferredLanguageId ?? config.langId;
      const externalLangId: number = configLangId ?? 1; // Default to 1 if not specified
      this.logger.debug(`Using language ID: ${externalLangId} (from connection config)`);

      // Step 6: Create cart in PrestaShop (required for order creation)
      this.logger.debug(`Creating cart in PrestaShop for order creation`);
      const prestashopCartData = this.orderMapper.mapCartCreate(
        order,
        externalCustomerId,
        externalProductIds,
        externalVariantIds,
        externalShippingAddressId,
        externalBillingAddressId,
        externalCurrencyId,
        externalLangId,
      );

      let externalCartId: string | number;
      try {
        const createdCart = await this.httpClient.createResource<{ id: string | number }>('carts', prestashopCartData);
        externalCartId = createdCart.id;
        this.logger.debug(`PrestaShop cart created successfully: cartId=${externalCartId}`);
      } catch (cartError) {
        const errorMessage = cartError instanceof Error ? cartError.message : String(cartError);
        this.logger.error(`Failed to create cart in PrestaShop: ${errorMessage}`);
        throw new PrestashopProvisioningException(
          `Failed to create cart in PrestaShop: ${errorMessage}`,
        );
      }

      // Step 7: Map OrderCreate to PrestaShop format (including cart ID, currency ID, and language ID)
      const prestashopOrderData = this.orderMapper.mapOrderCreate(
        order,
        externalCustomerId,
        externalProductIds,
        externalVariantIds,
        externalShippingAddressId,
        externalBillingAddressId,
        externalCurrencyId,
        externalLangId,
      );
      // Add cart ID to order data (required by PrestaShop)
      prestashopOrderData.id_cart = externalCartId;

      // Step 8: Create order in PrestaShop
      this.logger.debug(`Submitting order creation request to PrestaShop`);
      let createdOrder: PrestashopOrder;
      let externalOrderId: string;

      try {
        createdOrder = await this.httpClient.createResource<PrestashopOrder>('orders', prestashopOrderData);
        externalOrderId = String(createdOrder.id);
        this.logger.log(`PrestaShop order created successfully: externalOrderId=${externalOrderId}`);
      } catch (createError) {
        // Check if this is a duplicate key error (order already exists)
        // PrestaShop returns database errors in the response body when there's a 500 error
        // The error might be a QueryFailedError (TypeORM) if PrestaShop returns a database error
        let errorMessage = createError instanceof Error ? createError.message : String(createError);
        let responseBody = '';
        
        // Log error details for debugging (use warn level so it shows up)
        this.logger.warn(
          `Order creation error type: ${createError?.constructor?.name || 'unknown'}, message: ${errorMessage.substring(0, 200)}`,
        );
        
        // Check if it's a PrestashopApiException and has responseBody
        if (createError instanceof PrestashopApiException) {
          if (createError.responseBody) {
            responseBody = createError.responseBody;
            // Also check the response body for duplicate key errors
            errorMessage = `${errorMessage} ${responseBody}`;
            this.logger.warn(`PrestaShop API error response body: ${responseBody.substring(0, 500)}`);
          }
          this.logger.warn(`PrestaShop API error status code: ${createError.statusCode || 'unknown'}`);
        }
        
        // Check error message for duplicate key indicators (works for any error type)
        const isDuplicateKeyError =
          errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint');
        
        this.logger.warn(`Is duplicate key error: ${isDuplicateKeyError}, has order number: ${!!order.orderNumber}`);

        if (isDuplicateKeyError && order.orderNumber) {
          // Order might already exist - try to find it by reference
          this.logger.warn(
            `Duplicate key error when creating order, attempting to find existing order by reference: ${order.orderNumber}`,
          );

          try {
            // Query PrestaShop for the order by reference
            this.logger.warn(`Querying PrestaShop for existing order by reference: ${order.orderNumber}`);
            const existingOrders = await this.httpClient.listResources<PrestashopOrder>(
              'orders',
              {
                custom: {
                  reference: order.orderNumber,
                },
              },
              1,
              0,
            );

            this.logger.warn(`Found ${existingOrders.length} existing order(s) by reference: ${order.orderNumber}`);

            if (existingOrders.length > 0) {
              // Found existing order
              createdOrder = existingOrders[0];
              externalOrderId = String(createdOrder.id);
              this.logger.log(
                `Found existing PrestaShop order by reference: externalOrderId=${externalOrderId}, reference=${order.orderNumber}`,
              );
            } else {
              // Order not found by reference, re-throw original error
              this.logger.warn(`Order not found by reference, re-throwing original error`);
              throw createError;
            }
          } catch (queryError) {
            // Query failed, re-throw original error
            this.logger.error(
              `Failed to query PrestaShop for existing order by reference: ${queryError instanceof Error ? queryError.message : String(queryError)}`,
            );
            // Re-throw the original create error, not the query error
            throw createError;
          }
        } else {
          // Not a duplicate key error or no order number, re-throw
          throw createError;
        }
      }

      // Step 6: Write identifier mapping using the source-side internal id so that
      // Step 0's getExternalIds('Order', metadataInternalOrderId) finds this row on retry.
      let internalOrderId: string;
      if (metadataInternalOrderId) {
        try {
          await this.identifierMapping.createMapping(
            'Order',
            externalOrderId,
            this.connection.id,
            metadataInternalOrderId,
            {
              metadata: {
                orderNumber: order.orderNumber || createdOrder.reference,
                createdAt: new Date().toISOString(),
              },
            },
          );
        } catch (error) {
          if (error instanceof MappingAlreadyExistsError) {
            // Mapping was read before write (single-worker retry after a
            // prior successful createMapping).
            this.logger.debug(
              `Destination order mapping already present (read-before-write) for internalOrderId=${metadataInternalOrderId} externalOrderId=${externalOrderId}`,
            );
          } else if (error instanceof DuplicateIdentifierMappingError) {
            // Unique-constraint race: concurrent worker inserted the same
            // mapping between our read and our insert.
            this.logger.debug(
              `Destination order mapping race resolved (concurrent insert) for internalOrderId=${metadataInternalOrderId} externalOrderId=${externalOrderId}`,
            );
          } else {
            throw error;
          }
        }
        internalOrderId = metadataInternalOrderId;
      } else {
        // Defensive fallback: no source id in metadata, mint one (old behavior).
        // This path should not be reached in production — warn so drift is detectable.
        this.logger.warn(
          `createOrder invoked without metadata.internalOrderId for externalOrderId=${externalOrderId} connection=${this.connection.id} — idempotency check will be bypassed`,
        );
        internalOrderId = await this.identifierMapping.getOrCreateInternalId(
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
      }

      this.logger.log(
        `Order mapping created: externalOrderId=${externalOrderId}, internalOrderId=${internalOrderId}`,
      );

      // Step 7: Return order reference
      return {
        orderId: internalOrderId,
        orderNumber: createdOrder.reference || order.orderNumber || externalOrderId,
      };
    } catch (error) {
      if (
        error instanceof PrestashopResourceNotFoundException ||
        error instanceof PrestashopApiException ||
        error instanceof PrestashopProvisioningException
      ) {
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

