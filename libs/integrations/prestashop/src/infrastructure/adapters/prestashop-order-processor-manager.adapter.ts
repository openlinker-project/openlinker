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
import type { OrderProcessorManagerPort, OrderCreate, OrderRef } from '@openlinker/core/orders';
import type {
  DestinationOptionsReader,
  OrderFulfillmentUpdater,
  OrderStatus,
  MappingOption,
} from '@openlinker/core/orders';
import type {
  FulfillmentStatusReader,
  FulfillmentStatusSnapshot,
} from '@openlinker/core/orders';
import {
  extractTrackingFromCarriers,
  extractTrackingFromOrder,
  mapToFulfillmentStatusSnapshot,
} from '../mappers/prestashop-fulfillment-status.mapper';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { MappingAlreadyExistsError, DuplicateIdentifierMappingError, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { IPrestashopOpenLinkerModuleClient } from '../http/prestashop-openlinker-module.client.interface';
import type {
  IPrestashopOrderMapper,
  PrestashopOrder,
  PrestashopOrderCarrier,
} from '../mappers/prestashop.mapper.interface';
import type {
  PrestashopCarrier,
  PrestashopOrderState,
} from '../../domain/types/prestashop-options.types';
import { PRESTASHOP_PAYMENT_MODULES } from '../../domain/types/prestashop-payment-module.types';
import {
  PrestashopResourceNotFoundException,
  PrestashopApiException,
  PrestashopProvisioningException,
} from '@openlinker/integrations-prestashop';
import { Logger, formatBodyForLog } from '@openlinker/shared/logging';
import type { PrestashopCustomerProvisioner } from '../provisioners/prestashop-customer-provisioner';
import type { PrestashopAddressProvisioner } from '../provisioners/prestashop-address-provisioner';
import type { PrestashopCurrencyResolver } from '../provisioners/prestashop-currency-resolver';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import { PrestashopOlCarrierMissingException } from '../../domain/exceptions/prestashop-ol-module.exception';
import { hashEmail } from '@openlinker/shared/config';

/**
 * Subset of PS `/api/carriers` row fields used by `discoverDynamicCarrierId`.
 * Only `id`, `active`, `deleted` are inspected; the rest of the row (name,
 * delay, etc.) is ignored.
 */
interface PrestashopCarrierRow {
  id: string | number;
  active?: string | number;
  deleted?: string | number;
}

/**
 * PrestaShop Order Processor Manager Adapter
 *
 * Handles order creation in PrestaShop via WebService API.
 */
export class PrestashopOrderProcessorManagerAdapter
  implements
    OrderProcessorManagerPort,
    DestinationOptionsReader,
    OrderFulfillmentUpdater,
    FulfillmentStatusReader
{
  private readonly logger = new Logger(PrestashopOrderProcessorManagerAdapter.name);

  /**
   * Per-instance lazy cache of `GET /api/order_states` rows keyed by id —
   * used by `getFulfillmentStatus` to look up the order's current state
   * row by `current_state` (#834). One PS WS list call per adapter
   * instance.
   *
   * Lifetime contract (verified against
   * `libs/core/src/integrations/application/services/integrations.service.ts`):
   * `IntegrationsService.getCapabilityAdapter` constructs a fresh adapter
   * via the factory resolver on every call — no instance cache. The
   * branch-1 sync service (#834) resolves this adapter once per page and
   * reuses it for every record in the page, so this cache amortises one
   * `order_states` WS call across the whole page and is discarded when
   * the sync invocation returns. If a future refactor of
   * `getCapabilityAdapter` introduces adapter-instance caching across
   * ticks, revisit this cache — operator-added PS states would persist
   * stale here.
   */
  private orderStatesById: Map<string, PrestashopOrderState> | null = null;

  constructor(
    private readonly httpClient: IPrestashopWebserviceClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly orderMapper: IPrestashopOrderMapper,
    private readonly connection: Connection,
    private readonly customerProvisioner: PrestashopCustomerProvisioner,
    private readonly addressProvisioner: PrestashopAddressProvisioner,
    private readonly currencyResolver: PrestashopCurrencyResolver,
    private readonly customerProjectionRepository: CustomerProjectionRepositoryPort,
    // OL PrestaShop module client for HMAC-signed sidecar writes (#516).
    private readonly openlinkerModuleClient: IPrestashopOpenLinkerModuleClient,
    private readonly mappingConfigService?: IMappingConfigService
  ) {}

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    this.logger.log(
      `Creating PrestaShop order: orderNumber=${order.orderNumber || 'N/A'}, ` +
        `status=${order.status}, items=${order.items.length}, total=${order.totals.total} ${order.totals.currency}`
    );

    this.logger.debug(`order: ${JSON.stringify(order)}`);

    try {
      // Step 0: Check if order already exists (idempotency check)
      // If we have an internal order ID in metadata, check if we've already created this order
      const metadataInternalOrderId = order.metadata?.internalOrderId as string | undefined;
      if (metadataInternalOrderId) {
        const existingExternalIds = await this.identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.Order,
          metadataInternalOrderId
        );
        const existingPrestashopOrder = existingExternalIds.find(
          (e: { connectionId: string }) => e.connectionId === this.connection.id
        );

        if (existingPrestashopOrder) {
          this.logger.log(
            `Order already exists in PrestaShop: internalOrderId=${metadataInternalOrderId}, externalOrderId=${existingPrestashopOrder.externalId}`
          );
          // No reconcile here post-#516 — totals are correct on first POST
          // via the OL Dynamic carrier sidecar path (#515). Orders that
          // landed under the pre-#516 reconcile-PUT path stay at their
          // original totals (current_state may be 8); see epic #513
          // out-of-scope: backfill SQL.
          return {
            orderId: metadataInternalOrderId,
            orderNumber: order.orderNumber || String(existingPrestashopOrder.externalId),
          };
        }
      }

      // Step 1: Resolve or provision customer in PrestaShop
      let externalCustomerId: string | number;
      if (order.customerId) {
        const externalIds = await this.identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.Customer,
          order.customerId
        );
        const prestashopCustomerId = externalIds.find(
          (e: { connectionId: string }) => e.connectionId === this.connection.id
        );

        if (prestashopCustomerId) {
          // Mapping exists, use it
          externalCustomerId = prestashopCustomerId.externalId;
          this.logger.debug(`Resolved customer ID: ${order.customerId} → ${externalCustomerId}`);
        } else {
          // Mapping missing - provision guest customer
          this.logger.debug(
            `Customer mapping not found for ${order.customerId}, provisioning guest customer in PrestaShop`
          );

          // Get customer email from projection
          const customerProjection = await this.customerProjectionRepository.findById(
            order.customerId
          );
          if (!customerProjection || !customerProjection.normalizedEmail) {
            throw new PrestashopApiException(
              `Cannot provision customer: customer projection not found or email missing for ${order.customerId}`,
              undefined,
              undefined
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
            this.identifierMapping
          );

          externalCustomerId = provisionedCustomerId;
          this.logger.log(
            `Provisioned guest customer in PrestaShop: ${order.customerId} → ${externalCustomerId}`
          );
        }
      } else {
        // PrestaShop requires a customer ID. Customer should be resolved upstream by identity resolver.
        throw new PrestashopApiException(
          'Customer ID is required for PrestaShop order creation. ' +
            'Ensure customer identity is resolved before order creation.',
          undefined,
          undefined
        );
      }

      // Step 2: Resolve product and variant external IDs
      const externalProductIds = new Map<string, string | number>();
      const externalVariantIds = new Map<string, string | number>();

      for (const item of order.items) {
        // Resolve product ID
        const productExternalIds = await this.identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.Product,
          item.productId
        );
        const prestashopProductId = productExternalIds.find(
          (e: { connectionId: string }) => e.connectionId === this.connection.id
        );

        if (!prestashopProductId) {
          throw new PrestashopApiException(
            `Product not found in PrestaShop: ${item.productId} (no external ID mapping for connection ${this.connection.id})`,
            undefined,
            undefined
          );
        }

        externalProductIds.set(item.productId, prestashopProductId.externalId);

        // Resolve variant ID if present
        if (item.variantId) {
          const variantExternalIds = await this.identifierMapping.getExternalIds(
            CORE_ENTITY_TYPE.ProductVariant,
            item.variantId
          );
          const prestashopVariantId = variantExternalIds.find(
            (e: { connectionId: string }) => e.connectionId === this.connection.id
          );

          if (prestashopVariantId) {
            externalVariantIds.set(item.variantId, prestashopVariantId.externalId);
          }
          // If variant mapping not found, we'll use 0 (no variant) in the mapper
        }
      }

      this.logger.debug(
        `Resolved ${externalProductIds.size} product IDs and ${externalVariantIds.size} variant IDs`
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
          // Locker code goes onto the *shipping* address; the billing address
          // (if any) stays the buyer's home and shouldn't carry pickup-point info.
          order.pickupPoint
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
          this.customerProjectionRepository
        );
        this.logger.debug(`Resolved billing address ID: ${externalBillingAddressId}`);
      }

      // Step 4: Resolve currency ID
      const currencyCode = order.totals.currency || 'EUR'; // Default to EUR if not specified
      const externalCurrencyId = await this.currencyResolver.resolveCurrencyId(
        currencyCode,
        this.connection.id,
        this.httpClient
      );
      this.logger.debug(`Resolved currency ID: ${currencyCode} → ${externalCurrencyId}`);

      // Step 5: Get language ID from connection config
      const config = this.connection.config as unknown as PrestashopConnectionConfig;
      // Support both preferredLanguageId (new) and langId (deprecated, backward compatibility)
      const configLangId: number | undefined = config.preferredLanguageId ?? config.langId;
      const externalLangId: number = configLangId ?? 1; // Default to 1 if not specified
      this.logger.debug(`Using language ID: ${externalLangId} (from connection config)`);

      // Step 5b: Discover the OL Dynamic carrier id up front (#516). It's
      // used for two things in the new flow: (1) as the runtime fallback in
      // the resolution chain when neither mapping nor defaultCarrierId
      // resolves (R5 / IMP-1), and (2) to decide whether to write the
      // sidecar row before POST /orders. Discovery throws
      // PrestashopOlCarrierMissingException if the OL module isn't installed
      // — operator-actionable, aborts the sync cleanly before any PS write.
      const olDynamicCarrierId = await this.discoverDynamicCarrierId();

      // Step 5c: Resolve carrier id for #455 — carrier mapping at the destination.
      const externalCarrierId = await this.resolveExternalCarrierId(
        order,
        config,
        olDynamicCarrierId
      );

      // Step 6: Create cart in PrestaShop (required for order creation).
      // The carrier MUST be set on the cart, not just the order body — PS
      // resolves the order's id_carrier from the cart at POST /orders time
      // and ignores the order body's field (#503).
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
        externalCarrierId
      );

      let externalCartId: string | number;
      try {
        const createdCart = await this.httpClient.createResource<{ id: string | number }>(
          'carts',
          prestashopCartData
        );
        externalCartId = createdCart.id;
        this.logger.debug(`PrestaShop cart created successfully: cartId=${externalCartId}`);
      } catch (cartError) {
        const errorMessage = cartError instanceof Error ? cartError.message : String(cartError);
        this.logger.error(`Failed to create cart in PrestaShop: ${errorMessage}`);
        throw new PrestashopProvisioningException(
          `Failed to create cart in PrestaShop: ${errorMessage}`
        );
      }

      // Step 6.5: Sidecar write for the OL Dynamic carrier path (#516).
      // When the resolved carrier matches the OL Dynamic carrier id, write
      // the buyer-paid amount into the module's sidecar table BEFORE
      // POST /orders so PS can read the authoritative value via
      // getOrderShippingCostExternal() at order-total time. Static PS
      // carriers don't need this — PS computes shipping from their own
      // range tables. Throws PrestashopOlModuleException on non-2xx
      // (NOT best-effort; abort before order create rather than ship at
      // zero).
      if (externalCarrierId === olDynamicCarrierId) {
        const idCart = Number.parseInt(String(externalCartId), 10);
        // Free-text debug label — not load-bearing. We don't know the source
        // platform type from OrderSourceRef (only `connectionId` + `eventId`),
        // so the label leans on whichever neutral identifier is available.
        const sourceLabel = order.source
          ? `connection:${order.source.connectionId}` +
            (order.source.eventId ? `:event:${order.source.eventId}` : '') +
            (order.orderNumber ? `:order:${order.orderNumber}` : '')
          : order.orderNumber
            ? `order:${order.orderNumber}`
            : undefined;
        await this.openlinkerModuleClient.writeCartShipping({
          idCart,
          amountTaxExcl: order.totals.shipping,
          amountTaxIncl: order.totals.shipping,
          source: sourceLabel,
        });
        this.logger.debug(
          `OL sidecar written: idCart=${idCart} amountTaxIncl=${order.totals.shipping} ` +
            `source=${sourceLabel ?? '<none>'}`
        );
      }

      // Step 7: Map OrderCreate to PrestaShop format (including cart ID, currency ID, language ID, carrier ID)
      const prestashopOrderData = this.orderMapper.mapOrderCreate(
        order,
        externalCustomerId,
        externalProductIds,
        externalVariantIds,
        externalShippingAddressId,
        externalBillingAddressId,
        externalCurrencyId,
        externalLangId,
        externalCarrierId
      );
      // Add cart ID to order data (required by PrestaShop)
      prestashopOrderData.id_cart = externalCartId;

      // Step 8: Create order in PrestaShop
      this.logger.debug(`Submitting order creation request to PrestaShop`);
      let createdOrder: PrestashopOrder;
      let externalOrderId: string;

      try {
        createdOrder = await this.httpClient.createResource<PrestashopOrder>(
          'orders',
          prestashopOrderData
        );
        externalOrderId = String(createdOrder.id);
        this.logger.log(
          `PrestaShop order created successfully: externalOrderId=${externalOrderId}`
        );
      } catch (createError) {
        // Check if this is a duplicate key error (order already exists)
        // PrestaShop returns database errors in the response body when there's a 500 error
        // The error might be a QueryFailedError (TypeORM) if PrestaShop returns a database error
        let errorMessage = createError instanceof Error ? createError.message : String(createError);
        let responseBody = '';

        // Log error details for debugging (use warn level so it shows up)
        this.logger.warn(
          `Order creation error type: ${createError?.constructor?.name || 'unknown'}, message: ${formatBodyForLog(errorMessage)}`
        );

        // Check if it's a PrestashopApiException and has responseBody
        if (createError instanceof PrestashopApiException) {
          if (createError.responseBody) {
            responseBody = createError.responseBody;
            // Also check the response body for duplicate key errors
            errorMessage = `${errorMessage} ${responseBody}`;
            this.logger.warn(
              `PrestaShop API error response body: ${formatBodyForLog(responseBody)}`
            );
          }
          this.logger.warn(
            `PrestaShop API error status code: ${createError.statusCode || 'unknown'}`
          );
        }

        // Check error message for duplicate key indicators (works for any error type)
        const isDuplicateKeyError =
          errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint');

        this.logger.warn(
          `Is duplicate key error: ${isDuplicateKeyError}, has order number: ${!!order.orderNumber}`
        );

        if (isDuplicateKeyError && order.orderNumber) {
          // Order might already exist - try to find it by reference
          this.logger.warn(
            `Duplicate key error when creating order, attempting to find existing order by reference: ${order.orderNumber}`
          );

          try {
            // Query PrestaShop for the order by reference
            this.logger.warn(
              `Querying PrestaShop for existing order by reference: ${order.orderNumber}`
            );
            const existingOrders = await this.httpClient.listResources<PrestashopOrder>(
              'orders',
              {
                custom: {
                  reference: order.orderNumber,
                },
              },
              1,
              0
            );

            this.logger.warn(
              `Found ${existingOrders.length} existing order(s) by reference: ${order.orderNumber}`
            );

            if (existingOrders.length > 0) {
              // Found existing order
              createdOrder = existingOrders[0];
              externalOrderId = String(createdOrder.id);
              this.logger.log(
                `Found existing PrestaShop order by reference: externalOrderId=${externalOrderId}, reference=${order.orderNumber}`
              );
            } else {
              // Order not found by reference, re-throw original error
              this.logger.warn(`Order not found by reference, re-throwing original error`);
              throw createError;
            }
          } catch (queryError) {
            // Query failed, re-throw original error
            this.logger.error(
              `Failed to query PrestaShop for existing order by reference: ${queryError instanceof Error ? queryError.message : String(queryError)}`
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
            CORE_ENTITY_TYPE.Order,
            externalOrderId,
            this.connection.id,
            metadataInternalOrderId,
            {
              metadata: {
                orderNumber: order.orderNumber || createdOrder.reference,
                createdAt: new Date().toISOString(),
              },
            }
          );
        } catch (error) {
          if (error instanceof MappingAlreadyExistsError) {
            // Mapping was read before write (single-worker retry after a
            // prior successful createMapping).
            this.logger.debug(
              `Destination order mapping already present (read-before-write) for internalOrderId=${metadataInternalOrderId} externalOrderId=${externalOrderId}`
            );
          } else if (error instanceof DuplicateIdentifierMappingError) {
            // Unique-constraint race: concurrent worker inserted the same
            // mapping between our read and our insert.
            this.logger.debug(
              `Destination order mapping race resolved (concurrent insert) for internalOrderId=${metadataInternalOrderId} externalOrderId=${externalOrderId}`
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
          `createOrder invoked without metadata.internalOrderId for externalOrderId=${externalOrderId} connection=${this.connection.id} — idempotency check will be bypassed`
        );
        internalOrderId = await this.identifierMapping.getOrCreateInternalId(
          CORE_ENTITY_TYPE.Order,
          externalOrderId,
          this.connection.id,
          {
            metadata: {
              orderNumber: order.orderNumber || createdOrder.reference,
              createdAt: new Date().toISOString(),
            },
          }
        );
      }

      this.logger.log(
        `Order mapping created: externalOrderId=${externalOrderId}, internalOrderId=${internalOrderId}`
      );

      // Order created; PS computed shipping totals via the resolved carrier
      // — no reconcile needed post-#516. The OL Dynamic carrier path wrote
      // its sidecar row at Step 6.5; static carriers price from PS's own
      // zone tables.

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
        undefined
      );
    }
  }

  /**
   * Update an already-created PrestaShop order's status + tracking (#858,
   * capability `OrderFulfillmentUpdater`). Drives the destination half of the
   * #837 mark-sent orchestration; `externalOrderId` is the PS order id,
   * resolved upstream from the order's `syncStatus`.
   *
   * **Idempotent desired-state projector, not a state machine.** It projects the
   * supplied status onto the order; it does NOT enforce PS lifecycle ordering —
   * monotonicity/legality is the domain's concern (see #861/#827). Safe to
   * re-apply: the state transition is skipped when already in the target state,
   * and the tracking write is skipped when unchanged.
   *
   * **Ordering — tracking first, state last.** The single irreversible
   * side-effect is the buyer email, fired by `POST /order_histories` +
   * `sendmail=1` (the PS-intended primitive; never a `current_state`
   * full-replace, which skips side-effects). Tracking is written on the
   * `order_carriers` association *before* the transition so the "shipped" email
   * renders the tracking link, and so any failure before the email leaves a
   * clean, forward-recoverable state (no tracking-less email ever sent).
   *
   * **Non-atomic + forward-recoverable.** The two WS writes aren't transactional
   * (PS has no cross-request transaction). On partial failure we throw (surfaces
   * as a per-destination failure in the orchestration) and do NOT compensate —
   * the partial state is benign and converges on idempotent re-invocation. The
   * convergence guarantee (re-drive until reflected) belongs to the notify-state
   * layer (#861), not this adapter.
   */
  async updateFulfillment(input: {
    externalOrderId: string;
    status: OrderStatus;
    trackingNumber?: string;
  }): Promise<void> {
    const { externalOrderId, status, trackingNumber } = input;
    try {
      const order = await this.httpClient.getResource<PrestashopOrder>('orders', externalOrderId);
      const targetStateId = this.orderMapper.mapStatusToPrestashopStateId(status);

      // B. Tracking FIRST (when supplied) — so the state-email below renders the
      //    tracking link, and a failure here aborts before the irreversible email.
      if (trackingNumber) {
        await this.writeTracking(externalOrderId, trackingNumber);
      }

      // A. State transition LAST — the single irreversible side-effect.
      //    `sendmail: true` → `?sendmail=1` fires PS's order-state customer email.
      //    Skipped when already in the target state → idempotent (no duplicate
      //    "shipped" email on re-notify).
      if (Number(order.current_state) !== targetStateId) {
        await this.httpClient.createResource(
          'order_histories',
          { id_order: externalOrderId, id_order_state: targetStateId },
          { sendEmail: true }
        );
        this.logger.log(
          `PrestaShop order ${externalOrderId} → state ${targetStateId} (status='${status}') ` +
            `via order_histories+sendmail (connection: ${this.connection.id})`
        );
      } else {
        this.logger.debug(
          `PrestaShop order ${externalOrderId} already in state ${targetStateId} — ` +
            `skipping order_histories (connection: ${this.connection.id})`
        );
      }
    } catch (error) {
      if (
        error instanceof PrestashopResourceNotFoundException ||
        error instanceof PrestashopApiException
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to update PrestaShop order ${externalOrderId} fulfillment: ${message}`,
        error
      );
      throw new PrestashopApiException(
        `Failed to update PrestaShop order ${externalOrderId} fulfillment: ${message}`,
        undefined,
        undefined,
        this.connection.id
      );
    }
  }

  /**
   * Branch-1 (#834) `FulfillmentStatusReader` implementation. Reads the PS
   * order, looks up the matching `order_state` row via a per-instance lazy
   * cache (one WS list call per adapter instance), reads the order's
   * `order_carriers` for tracking fallback, and delegates to the pure
   * mapper.
   *
   * Returns `{ status: null, ... }` when PS hasn't reached a shipping-
   * related state (the projection-only "skip this record this pass"
   * signal). Returns `{ status: 'delivered' | 'dispatched' | 'cancelled', ... }`
   * once PS has acted, with tracking number and (for delivered) the
   * `date_upd` timestamp threaded through.
   */
  async getFulfillmentStatus(input: {
    externalOrderId: string;
  }): Promise<FulfillmentStatusSnapshot> {
    const { externalOrderId } = input;
    try {
      const order = await this.httpClient.getResource<PrestashopOrder>(
        'orders',
        externalOrderId,
      );
      const stateId = order.current_state !== undefined ? String(order.current_state) : null;
      const state = stateId !== null ? await this.lookupOrderState(stateId) : null;
      // Lazy carriers fetch: most PS configurations populate `shipping_number`
      // directly on the order when the operator prints the label, so the
      // carriers WS call is unnecessary for the majority of records. Skip
      // it whenever we already have a value — halves PS API pressure at
      // scale without changing observable behaviour.
      const trackingFromOrder = extractTrackingFromOrder(order);
      const trackingNumber =
        trackingFromOrder ?? extractTrackingFromCarriers(
          await this.httpClient.listResources<PrestashopOrderCarrier>('order_carriers', {
            custom: { id_order: externalOrderId },
          }),
        );
      return mapToFulfillmentStatusSnapshot(order, state, trackingNumber);
    } catch (error) {
      if (error instanceof PrestashopResourceNotFoundException) {
        // Order was deleted PS-side after OL mirrored it. Treat as
        // "OMP hasn't acted" — the sync service skips, the row stays
        // visible in /orders, and operator action surfaces the missing
        // order through the dispatch-notify failure path (#871) if any
        // branch-2/3 sibling exists.
        this.logger.warn(
          `PrestaShop order ${externalOrderId} not found during fulfillment-status read (connection: ${this.connection.id})`,
        );
        return { status: null, trackingNumber: null, deliveredAt: null };
      }
      throw error;
    }
  }

  /**
   * Look up an `order_state` row by id, lazy-loading the full map on first
   * call. Returns `null` for unknown ids (orphaned `current_state` — treat
   * as "not yet acted" per the mapper's `state === null` branch).
   */
  private async lookupOrderState(stateId: string): Promise<PrestashopOrderState | null> {
    if (this.orderStatesById === null) {
      const rows = await this.httpClient.listResources<PrestashopOrderState>(
        'order_states',
        { custom: { deleted: '0' } },
        1000,
        0,
      );
      const map = new Map<string, PrestashopOrderState>();
      for (const row of rows) {
        map.set(String(row.id), row);
      }
      this.orderStatesById = map;
    }
    return this.orderStatesById.get(stateId) ?? null;
  }

  /**
   * Set `tracking_number` on the order's **current** `order_carriers` row — the
   * highest `id_order_carrier` (PrestaShop's notion of the active carrier;
   * re-ships append new rows, `Order::getIdOrderCarrier` reads `DESC`). The WS
   * PUT is full-replace, so we read-then-write the whole row. Idempotent: skips
   * when the value is already set.
   *
   * If no `order_carriers` row exists (anomalous — PS auto-creates one for any
   * carried order), we warn and skip rather than fabricate a PS-managed row;
   * the state transition still applies and the anomaly surfaces in logs.
   */
  private async writeTracking(externalOrderId: string, trackingNumber: string): Promise<void> {
    const rows = await this.httpClient.listResources<PrestashopOrderCarrier>('order_carriers', {
      custom: { id_order: externalOrderId },
    });
    if (rows.length === 0) {
      this.logger.warn(
        `PrestaShop order ${externalOrderId} has no order_carriers row — cannot attach ` +
          `tracking '${trackingNumber}' (connection: ${this.connection.id})`
      );
      return;
    }
    // PS's "current" carrier is the highest id_order_carrier; WS list ordering is
    // unspecified, so pick max-id explicitly rather than trusting rows[0].
    const row = rows.reduce((latest, r) => (Number(r.id) > Number(latest.id) ? r : latest));

    if (String(row.tracking_number ?? '') === trackingNumber) {
      this.logger.debug(
        `PrestaShop order ${externalOrderId} tracking already '${trackingNumber}' — ` +
          `skipping order_carriers write (connection: ${this.connection.id})`
      );
      return;
    }
    await this.httpClient.updateResource('order_carriers', row.id, {
      ...row,
      tracking_number: trackingNumber,
    });
  }

  /**
   * Discover the PrestaShop `id_carrier` of the OpenLinker Dynamic carrier
   * row installed by the OL PS module (#515 / PR #524).
   *
   * Filters on `external_module_name=openlinker` via PS WS `filter[…]=[…]`
   * (handled by the http client's `custom` option). We deliberately do NOT
   * filter `active`/`deleted` server-side — PrestaShop has a documented bug
   * (forge issue #28424) where `filter[active]` returns inverted results;
   * the safer fix is to fetch the (small, single-digit) result set keyed by
   * `external_module_name` and post-filter `active=1, deleted=0` in TS.
   *
   * Throws PrestashopOlCarrierMissingException if no live row exists —
   * surfaces operator-actionable installation/activation issues fast and
   * aborts the sync before any PS-side write. Logs a warning if multiple
   * live rows exist (operator likely cloned the carrier in BO) and uses
   * the first; this is a benign-but-noisy state that the operator should
   * resolve.
   */
  private async discoverDynamicCarrierId(): Promise<number> {
    const rows = await this.httpClient.listResources<PrestashopCarrierRow>(
      'carriers',
      { custom: { external_module_name: 'openlinker' } },
      100,
      0
    );
    const live = rows.filter((r) => Number(r.active) === 1 && Number(r.deleted) === 0);

    if (live.length === 0) {
      throw new PrestashopOlCarrierMissingException(this.connection.id);
    }

    if (live.length > 1) {
      this.logger.warn(
        `Multiple live OL Dynamic carrier rows on connection ${this.connection.id} ` +
          `(count=${live.length}, ids=[${live.map((r) => String(r.id)).join(',')}]). ` +
          `Using first; operator should remove duplicates in PS Back Office.`
      );
    }

    // PS WS is a trust boundary — `id` is typed `string | number` but the wire
    // payload is operator-controlled (PS BO edits) and could in theory deliver
    // garbage that coerces to NaN or a non-positive integer. Treat that as
    // "module not installed" rather than letting NaN propagate into the cart
    // mapper as `id_carrier=NaN` and reproduce #503 through a different door.
    const id = Number(live[0].id);
    if (!Number.isFinite(id) || id <= 0) {
      this.logger.warn(
        `OL Dynamic carrier row on connection ${this.connection.id} has invalid id=${String(live[0].id)} ` +
          `(must be a positive integer). Treating as missing; aborting order create.`
      );
      throw new PrestashopOlCarrierMissingException(this.connection.id);
    }

    this.logger.debug(
      `Resolved OL Dynamic carrier on connection ${this.connection.id}: id_carrier=${id}`
    );
    return id;
  }

  /**
   * Resolve the PrestaShop `id_carrier` to use when creating an order (#455 / #516).
   *
   * Resolution chain:
   *   1. `MappingConfigService.resolveCarrierMapping(sourceConnectionId, methodId)`
   *   2. `connection.config.defaultCarrierId`
   *   3. `olDynamicCarrierId` — runtime fallback so unmapped methods still
   *      get a working carrier without an operator config write. The OL
   *      Dynamic carrier writes the buyer-paid amount via the sidecar at
   *      Step 6.5.
   *
   * No throw path — `discoverDynamicCarrierId` already threw upstream if
   * the OL module isn't installed, so this method always returns a
   * positive integer.
   */
  private async resolveExternalCarrierId(
    order: OrderCreate,
    config: PrestashopConnectionConfig,
    olDynamicCarrierId: number
  ): Promise<number> {
    const sourceConnectionId = order.source?.connectionId;
    const methodId = order.shipping?.methodId;
    const methodName = order.shipping?.methodName;

    if (this.mappingConfigService && sourceConnectionId && methodId) {
      const mapped = await this.mappingConfigService.resolveCarrierMapping(
        sourceConnectionId,
        methodId
      );
      if (mapped) {
        const parsed = Number.parseInt(mapped, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          this.logger.debug(
            `Resolved carrier mapping: methodId=${methodId} → id_carrier=${parsed} ` +
              `(sourceConnectionId=${sourceConnectionId}, destinationConnectionId=${this.connection.id})`
          );
          return parsed;
        }
        this.logger.warn(
          `Carrier mapping resolved to non-positive integer "${mapped}" — ignoring. ` +
            `methodId=${methodId} sourceConnectionId=${sourceConnectionId}`
        );
      }
    }

    if (config.defaultCarrierId !== undefined) {
      // Defend against operator-misconfigured defaults (0, negative, NaN).
      // Without this guard the mapper writes id_carrier=0 to the cart and
      // we reproduce the #503 failure mode through a different door — `??`
      // doesn't fall back on 0, only null/undefined.
      if (Number.isFinite(config.defaultCarrierId) && config.defaultCarrierId > 0) {
        this.logger.warn(
          `No carrier mapping for methodId=${methodId ?? '<none>'} (methodName=${methodName ?? '<none>'}, ` +
            `sourceConnectionId=${sourceConnectionId ?? '<none>'}, destinationConnectionId=${this.connection.id}). ` +
            `Falling back to connection.config.defaultCarrierId=${config.defaultCarrierId}.`
        );
        return config.defaultCarrierId;
      }
      this.logger.warn(
        `Connection config has invalid defaultCarrierId=${String(config.defaultCarrierId)} (must be a positive integer) ` +
          `for connection ${this.connection.id} — ignoring; falling back to OL Dynamic carrier id_carrier=${olDynamicCarrierId}.`
      );
    }

    this.logger.warn(
      `No carrier mapping for methodId=${methodId ?? '<none>'} (methodName=${methodName ?? '<none>'}, ` +
        `sourceConnectionId=${sourceConnectionId ?? '<none>'}, destinationConnectionId=${this.connection.id}) ` +
        `and no defaultCarrierId on connection config. Falling back to OL Dynamic carrier id_carrier=${olDynamicCarrierId}.`
    );
    return olDynamicCarrierId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DestinationOptionsReader (#472 / #473)
  //
  // Live PS WS list endpoints powering the carrier-mapping UI dropdowns. Each
  // method maps the raw PS row to the neutral `MappingOption` shape; `value`
  // is the stable identifier persisted by mapping config (id_reference for
  // carriers, id for order_states, name for modules), `label` is the human
  // string the operator picks from.
  // ─────────────────────────────────────────────────────────────────────────

  async listCarriers(): Promise<MappingOption[]> {
    const rows = await this.httpClient.listResources<PrestashopCarrier>(
      'carriers',
      { custom: { active: '1', deleted: '0' } },
      1000,
      0
    );
    return rows.map((row) => {
      const option: MappingOption = {
        value: String(row.id_reference),
        label: this.flattenLanguageField(row.name),
      };
      // OpenLinker Dynamic carrier (#515 / #516 / #517): the PS module
      // installs the carrier with `external_module_name='openlinker'`.
      // Mark the option so the FE can decorate the dropdown — runtime
      // routing already happens in the order-processor adapter, this is
      // presentation-only.
      if (row.external_module_name === 'openlinker') {
        option.kind = 'dynamic';
      }
      return option;
    });
  }

  async listOrderStatuses(): Promise<MappingOption[]> {
    const rows = await this.httpClient.listResources<PrestashopOrderState>(
      'order_states',
      { custom: { deleted: '0' } },
      1000,
      0
    );
    return rows.map((row) => ({
      value: String(row.id),
      label: this.flattenLanguageField(row.name),
    }));
  }

  // PS Webservice keys are not granted access to `/api/modules` by default
  // (see #483) — the dropdown reads from a curated list of common modules
  // composed with an optional per-connection `paymentModuleOverrides`.
  // Saved mappings still resolve by exact-string match at order-create time,
  // so the curated list constrains adding new mappings only.
  listPaymentMethods(): Promise<MappingOption[]> {
    const config = this.connection.config as unknown as PrestashopConnectionConfig;
    const overrides = config.paymentModuleOverrides ?? [];
    if (overrides.length === 0) {
      return Promise.resolve([...PRESTASHOP_PAYMENT_MODULES]);
    }
    const seen = new Set(PRESTASHOP_PAYMENT_MODULES.map((m) => m.value));
    const extra: MappingOption[] = [];
    for (const name of overrides) {
      if (seen.has(name)) continue;
      seen.add(name);
      extra.push({ value: name, label: name });
    }
    return Promise.resolve([...PRESTASHOP_PAYMENT_MODULES, ...extra]);
  }

  /**
   * PS WS multi-language fields can come back as either a flat string (when
   * the install has `id_lang=1` configured as the default response language)
   * or as `{ language: [{ '@attributes': { id: '1' }, '#text': 'Carrier name' }] }`
   * (when JSON is requested without a language pin). Defensively unwrap.
   */
  private flattenLanguageField(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const langArray = (value as { language?: unknown }).language;
      if (Array.isArray(langArray) && langArray.length > 0) {
        const first = langArray[0] as { '#text'?: unknown; value?: unknown };
        if (typeof first['#text'] === 'string') return first['#text'];
        if (typeof first.value === 'string') return first.value;
      }
    }
    return '';
  }
}
