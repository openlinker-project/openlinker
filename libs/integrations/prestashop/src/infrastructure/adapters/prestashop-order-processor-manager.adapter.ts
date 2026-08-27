/**
 * PrestaShop Order Processor Manager Adapter
 *
 * Implements OrderProcessorManagerPort for PrestaShop WebService API. Handles
 * order creation in PrestaShop by mapping unified Order schema to PrestaShop
 * format and using IdentifierMappingService to resolve external IDs.
 *
 * Idempotency contract (#909): create-or-skip and the external↔internal order
 * mapping write are owned by `OrderSyncService` under a per-(order, destination)
 * lock — this adapter creates unconditionally and returns the destination-native
 * external order id. PS-side duplicate-key recovery (recover the existing order
 * id by reference) is retained as defense-in-depth.
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
  OrderStatusWriteback,
  OrderLifecycleEvent,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import type { FulfillmentStatusReader, FulfillmentStatusSnapshot } from '@openlinker/core/orders';
import {
  extractTrackingFromCarriers,
  extractTrackingFromOrder,
  mapToFulfillmentStatusSnapshot,
} from '../mappers/prestashop-fulfillment-status.mapper';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type {
  IPrestashopOpenLinkerModuleClient,
  ImportOrderLinePrice,
} from '../http/prestashop-openlinker-module.client.interface';
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
  PrestashopTaxRateUnknownException,
  PrestashopCurrencyUnknownException,
} from '@openlinker/integrations-prestashop';
import { Logger, formatBodyForLog } from '@openlinker/shared/logging';
import type { PrestashopCustomerProvisioner } from '../provisioners/prestashop-customer-provisioner';
import type { PrestashopAddressProvisioner } from '../provisioners/prestashop-address-provisioner';
import type { PrestashopCurrencyResolver } from '../provisioners/prestashop-currency-resolver';
import type { PrestashopTaxRateResolver } from '../provisioners/prestashop-tax-rate.resolver';
import type { PrestashopTaxRateUnknown } from '../provisioners/prestashop-tax-rate.types';
import { allocateByLargestRemainder } from '@openlinker/shared/money';
import { isTruthyStateFlag } from '../mappers/prestashop-order-state-semantics';
import { toPrestashopProductAttributeId } from '../mappers/prestashop-variant-id';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import { PrestashopOlCarrierMissingException } from '../../domain/exceptions/prestashop-ol-module.exception';
import { PrestashopOrderStateUnresolvedException } from '../../domain/exceptions/prestashop-order-state-unresolved.exception';
import { PrestashopOrderStateCatalog } from '../provisioners/prestashop-order-state.catalog';
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
 * Active-window length for a pinned `specific_prices` row's `to` field — a
 * crash fail-safe so an un-deleted pin self-expires rather than lingering. A
 * full day is generous against shop-timezone skew (the order is created seconds
 * after the pin) while still bounding any orphan's active life (#895).
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
    OrderStatusWriteback,
    FulfillmentStatusReader
{
  private readonly logger = new Logger(PrestashopOrderProcessorManagerAdapter.name);

  /**
   * Per-instance cache of the shop's own `order_states` rows (#2607), used in
   * both directions: reading what an order's `current_state` means (#834) and
   * choosing which state to write for a neutral status. No default-install id
   * is assumed in either direction.
   *
   * Lifetime contract (verified against
   * `libs/core/src/integrations/application/services/integrations.service.ts`):
   * `IntegrationsService.getCapabilityAdapter` constructs a fresh adapter
   * via the factory resolver on every call - no instance cache. The
   * branch-1 sync service (#834) resolves this adapter once per page and
   * reuses it for every record in the page, so this cache amortises one
   * `order_states` WS call across the whole page and is discarded when
   * the sync invocation returns. If a future refactor of
   * `getCapabilityAdapter` introduces adapter-instance caching across
   * ticks, revisit this cache - operator-added PS states would persist
   * stale here.
   */
  private readonly orderStates: PrestashopOrderStateCatalog;

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
    // Resolves the destination product's tax rate so buyer-paid gross line
    // prices can be pinned net via `specific_prices` (#895 / ADR-014).
    private readonly taxRateResolver: PrestashopTaxRateResolver,
    private readonly mappingConfigService?: IMappingConfigService
  ) {
    this.orderStates = new PrestashopOrderStateCatalog(httpClient, connection.id);
  }

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    this.logger.log(
      `Creating PrestaShop order: orderNumber=${order.orderNumber || 'N/A'}, ` +
        `status=${order.status}, items=${order.items.length}, total=${order.totals.total} ${order.totals.currency}`
    );

    this.logger.debug(`order: ${JSON.stringify(order)}`);

    // Step 0: Refuse an order that carries no currency, before ANY PrestaShop
    // write (#2139).
    //
    // This used to read `order.totals.currency || 'EUR'`, while the snapshot
    // path defaults the field to `''` (`order-from-ready-snapshot.ts`) - so an
    // order that carried no currency asked the shop for EUR, and on a shop
    // where EUR is active that resolved to a real-but-wrong id without ever
    // reaching the resolver's own guards. The line amounts pinned downstream
    // are the buyer-paid source numerals (#895 / ADR-014), so the order would
    // be booked with the right numbers under the wrong denomination.
    //
    // The check is pure - it reads only fields this method already holds on
    // entry - so it sits ahead of guest-customer provisioning (Step 1) and
    // address provisioning (Step 3). Both create real PrestaShop rows, and a
    // refusal must not leave any behind. The resolver-side refusal cannot be
    // hoisted the same way: it needs the shop read, so it stays at Step 4.
    //
    // `?? ''` before `.trim()` is defensive against untyped snapshot JSON;
    // `OrderTotals.currency` is a required `string` and the real-world value
    // is `''`, not `undefined`.
    const currencyCode = (order.totals.currency ?? '').trim();
    if (currencyCode === '') {
      throw new PrestashopCurrencyUnknownException(
        `Order ${order.orderNumber || '(no reference)'}: no currency - the source ` +
          `order carries no ISO 4217 code, so its PrestaShop currency cannot be ` +
          `resolved. No order was created.`,
        undefined,
        this.connection.id
      );
    }

    // Cart-scoped `specific_prices` rows created to pin line prices (#895).
    // Declared outside the try so the success path and the catch can both
    // best-effort clean them up. They're transient (the price is materialised
    // into `order_detail` at POST /orders); cart-scoped so they never affect
    // another cart, and carry a short `to`-expiry as a crash fail-safe.
    const pinnedPriceIds: Array<string | number> = [];

    try {
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

      // Step 4: Resolve the currency ID. `currencyCode` is non-empty by the
      // Step 0 guard above; an ISO the shop does not carry, or a row with an
      // unusable id, is refused by the resolver itself (#2139).
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

      // Step 6.6: Resolve every line's buyer-paid (source-authoritative) net
      // unit price, to be pinned as cart-scoped `specific_prices` before the
      // order is created (#895 / ADR-014). PS prices the order's
      // `order_detail` from the cart; without
      // this it would use the catalog price and land the order in
      // `Payment error`. Per the createOrder invariant, a line we cannot pin
      // MUST fail (throw) rather than silently mis-price — `pinLinePrices`
      // records created ids into `pinnedPriceIds` as it goes, so the outer
      // catch cleans up any partial pins before the error propagates.
      const linePins = await this.resolveLinePins(order, externalProductIds, externalVariantIds);

      // A module that advertises `line_prices` pins the whole set inside the
      // order-import request below, which is two fewer Webservice calls per
      // line - sixteen of twenty-seven on an eight-line order (#2597). The
      // capability is learned from a previous import response, so the first
      // order after a restart still takes this path.
      const moduleWritesLinePins =
        linePins.length > 0 && this.openlinkerModuleClient.supportsLinePrices();
      if (linePins.length > 0 && !moduleWritesLinePins) {
        await this.postLinePins(
          linePins,
          externalCartId,
          externalCustomerId,
          externalCurrencyId,
          pinnedPriceIds
        );
      }

      // Step 7+8: Create the order through PrestaShop's canonical flow —
      // PaymentModule::validateOrder via the OL module's `importorder` endpoint
      // (ADR-016 / #905), NOT the raw WS POST /orders, which bypasses
      // validateOrder and silently drops the carrier + recomputes shipping
      // (root of #503/#467/#513/#898). The cart (carrier + delivery address),
      // the OL sidecar (#516), and the cart-scoped specific_prices (#895) are
      // already in place; the module sets the cart's delivery_option then calls
      // validateOrder with $dont_touch_amount so OL's total is authoritative.
      const stateId = await this.resolveStateId(order.status);
      await this.warnIfUnpaidOrderBooksAsSettled(order, stateId);
      let externalOrderId: string;
      let resolvedReference: string;

      // Reconciliation sanity-check (ADR-016): `amountPaid` is sent with
      // `$dont_touch_amount=true`, so PS records it verbatim as `total_paid_real`
      // while `total_paid` is recomputed from the cart (pinned lines + sidecar
      // shipping). If the two diverge, validateOrder re-raises the exact
      // "X paid instead of Y" Payment-error banner #898 set out to kill. We
      // can't see the PS-side cart total without a round-trip, but we CAN catch
      // the common cause — an order-level discount/adjustment not represented in
      // `subtotal + shipping` — from OrderCreate's own totals. Warn (not throw):
      // this is observability, the int-spec is the hard gate.
      const expectedCartTotal = order.totals.subtotal + order.totals.shipping;
      if (Math.abs(expectedCartTotal - order.totals.total) > 0.01) {
        this.logger.warn(
          `Order total reconciliation drift for orderNumber=${order.orderNumber ?? 'N/A'}: ` +
            `subtotal(${order.totals.subtotal}) + shipping(${order.totals.shipping}) = ${expectedCartTotal} ` +
            `≠ total(${order.totals.total}). validateOrder may flag a payment mismatch — ` +
            `an order-level discount/adjustment is likely not reflected in the rebuilt cart.`
        );
      }

      // PS-side duplicate recovery (defense-in-depth, retained per #909): the
      // adapter creates unconditionally — idempotency proper (skip-if-exists +
      // the external↔internal mapping write) is owned by OrderSyncService under
      // a per-(order, destination) lock. This reference lookup only recovers the
      // existing order on a retry that rebuilt the cart (new id_cart, so the
      // endpoint's own cart-keyed idempotency can't see the prior order).
      const preexistingOrder = order.orderNumber
        ? await this.findExistingOrderByReference(order.orderNumber)
        : null;

      // Without an orderNumber the reference recovery above is unavailable AND
      // validateOrder mints its own random reference. Source orders always carry
      // an orderNumber (e.g. Allegro checkoutFormId), so this is a
      // should-not-happen guard — warn so the drift is detectable. The
      // OrderSyncService lock + source-id mapping remain the primary idempotency.
      if (!order.orderNumber) {
        this.logger.warn(
          `createOrder invoked without order.orderNumber for externalCartId=${externalCartId} ` +
            `connection=${this.connection.id} — reference-based duplicate recovery is unavailable; ` +
            `relying on OrderSyncService lock + source-id mapping for idempotency.`
        );
      }

      if (preexistingOrder) {
        externalOrderId = String(preexistingOrder.id);
        resolvedReference = preexistingOrder.reference || order.orderNumber || externalOrderId;
        this.logger.log(
          `Reusing existing PrestaShop order by reference=${order.orderNumber}: externalOrderId=${externalOrderId}`
        );
      } else {
        this.logger.debug(`Submitting order import (validateOrder) request to PrestaShop`);
        try {
          const imported = await this.openlinkerModuleClient.importOrder({
            idCart: Number.parseInt(String(externalCartId), 10),
            idOrderState: stateId,
            amountPaid: order.totals.total,
            // Matches the payment provenance the WS path recorded — the module
            // delegates to ps_checkpayment::validateOrder.
            paymentMethod: 'Check payment',
            orderReference: order.orderNumber ?? '',
            ...(moduleWritesLinePins ? { linePrices: linePins } : {}),
          });
          externalOrderId = String(imported.idOrder);
          resolvedReference = imported.reference;
          this.logger.log(
            `PrestaShop order created via validateOrder: externalOrderId=${externalOrderId} ` +
              `reference=${resolvedReference} alreadyExisted=${imported.alreadyExisted}`
          );
        } catch (createError) {
          const msg = createError instanceof Error ? createError.message : String(createError);
          this.logger.error(
            `Failed to create order via OL module importOrder: ${formatBodyForLog(msg)}`
          );
          throw createError;
        }
      }

      // Order created; PS computed shipping totals via the resolved carrier
      // — no reconcile needed post-#516. The OL Dynamic carrier path wrote
      // its sidecar row at Step 6.5; static carriers price from PS's own
      // zone tables. The external↔internal order mapping is persisted by
      // OrderSyncService under the per-(order, destination) lock (#909).

      // The line prices are now materialised into `order_detail`; the pin rows
      // have served their purpose. Best-effort cleanup (never throws).
      await this.cleanupPinnedPrices(pinnedPriceIds);

      // Step 9: Return the destination-native external order id (#909).
      return {
        orderId: externalOrderId,
        orderNumber: resolvedReference || order.orderNumber || externalOrderId,
      };
    } catch (error) {
      // Best-effort cleanup on the failure path too — the short `to`-expiry
      // bounds the harm of any pin row we can't delete here.
      await this.cleanupPinnedPrices(pinnedPriceIds);
      if (
        error instanceof PrestashopResourceNotFoundException ||
        error instanceof PrestashopApiException ||
        error instanceof PrestashopProvisioningException ||
        // Re-thrown unchanged so the operator-facing message reaches
        // `syncStatus[].error` verbatim: the wrapping below would prepend 35
        // characters and push the product identity out of every truncated
        // surface that renders it (#2052 — see `taxRateUnknownError`).
        error instanceof PrestashopTaxRateUnknownException ||
        // Same contract for the currency refusal (#2139). What it buys today is
        // the operator-facing message: wrapping prepends 35 characters and
        // pushes the currency identity out of the truncated surfaces. It also
        // preserves the class the retry classifier keys on - which the shipped
        // caller chain does not currently consult, since `OrderSyncService`
        // reduces a per-destination create rejection to its message under
        // `Promise.allSettled` and `OrderIngestionService` records it without
        // rethrowing, so the job succeeds and is never retried. Preserved for
        // correctness, and for the day the failure does reach the retry path.
        error instanceof PrestashopCurrencyUnknownException
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
   * Pin each order line to its buyer-paid (source-authoritative) price via a
   * cart-scoped `specific_prices` row, so PrestaShop values the order's
   * `order_detail` at the marketplace price instead of the catalog price
   * (#895 / ADR-014).
   *
   * `specific_prices.price` is tax-EXCLUDED. When the source reports GROSS
   * prices (`taxTreatment` `inclusive`, or unset — the marketplace default) the
   * gross is converted to net using the destination product's own tax rate, so
   * PS re-grosses it back to the buyer-paid amount. A rate the resolver cannot
   * determine throws (#2052) — see {@link taxRateUnknownError}; pinning
   * `net = gross` in that case lets PS add its own VAT on top and creates an
   * order costing more than the buyer paid. When the source reports NET
   * (`exclusive`) the price is pinned as-is and no rate is read at all. The
   * buyer-paid product subtotal is apportioned across lines with a
   * largest-remainder allocation so the pinned lines sum exactly to the
   * authoritative total under rounding.
   *
   * This resolves the net unit price of every line and returns it. Who writes
   * it depends on the shop's module: a build that advertises `line_prices`
   * takes the whole set inside the order-import request it already receives
   * (#2597), and only an older one needs the two Webservice calls per line that
   * {@link postLinePins} makes. Per the createOrder invariant (ADR-014), a line
   * whose price cannot be resolved throws either way — a silently-unpinned line
   * would be priced from the catalog and land the order in `Payment error`,
   * which is the bug this fixes.
   */
  private async resolveLinePins(
    order: OrderCreate,
    externalProductIds: Map<string, string | number>,
    externalVariantIds: Map<string, string | number>
  ): Promise<ImportOrderLinePrice[]> {
    if (order.items.length === 0) {
      return [];
    }

    const pins: ImportOrderLinePrice[] = [];

    // `exclusive` → already net; everything else (`inclusive`/unset) → gross,
    // convert to net. Marketplace orders are gross, so unset defaults to gross.
    // A future NET source that omits `taxTreatment` would be mis-converted —
    // tracked as the deferred `tax?`/treatment hardening in ADR-014.
    const convertGrossToNet = order.totals.taxTreatment !== 'exclusive';
    const deliveryCountryIso = order.shippingAddress?.country;

    // Apportion the gross product subtotal across lines (minor units) so the
    // pinned lines sum exactly to the authoritative total. NOTE: the pinned
    // price is per-UNIT, so for a multi-quantity line a 1-cent line residual
    // becomes sub-cent per unit and PS may round it away when it re-grosses
    // unit × qty — the order total can still differ by a per-line rounding cent
    // (asserted within tolerance by the int-spec, not bit-exact).
    const subtotalMinor = Math.round(order.totals.subtotal * 100);
    const weightsMinor = order.items.map((item) => Math.round(item.price * item.quantity * 100));
    const lineGrossMinor = allocateByLargestRemainder(subtotalMinor, weightsMinor);

    for (let index = 0; index < order.items.length; index++) {
      const item = order.items[index];
      if (item.quantity <= 0) {
        continue;
      }
      const externalProductId = externalProductIds.get(item.productId);
      if (externalProductId === undefined) {
        continue; // resolution already guaranteed this in Step 2
      }
      // Coerce the per-connection external variant id to a numeric PrestaShop
      // `id_product_attribute`. Simple products map to a synthetic-variant
      // marker (`product:<n>`), which PS 400-rejects as a non-numeric
      // `id_product_attribute` — collapse it (and any unmapped variant) to 0,
      // matching the order/cart mapper (#923).
      const externalVariantId = toPrestashopProductAttributeId(
        item.variantId ? externalVariantIds.get(item.variantId) : undefined
      );

      const grossUnit = lineGrossMinor[index] / 100 / item.quantity;
      let rate = 0;
      if (convertGrossToNet) {
        const resolution = await this.taxRateResolver.resolveProductTaxRate(
          externalProductId,
          deliveryCountryIso,
          this.connection.id,
          this.httpClient
        );
        if (resolution.kind === 'unknown') {
          // Fail loudly (createOrder invariant, ADR-014 / #2052). Pinning
          // `net = gross` here is what made PrestaShop add its own VAT on top
          // and create an order costing more than the buyer paid — a wrong
          // order is worse than no order, and no order was created yet.
          throw this.taxRateUnknownError(
            resolution,
            order.totals.currency,
            grossUnit,
            externalProductId,
            item.sku
          );
        }
        rate = resolution.rate;
      }
      const netUnit = grossUnit / (1 + rate);

      pins.push({
        idProduct: Number(externalProductId),
        idProductAttribute: Number(externalVariantId),
        // Six decimals, the same precision the Webservice path pinned with, so
        // the module and the fallback price a line identically.
        price: netUnit.toFixed(6),
      });
      this.logger.debug(
        `Resolved line price: product=${externalProductId} variant=${externalVariantId} ` +
          `grossUnit=${grossUnit.toFixed(4)} rate=${rate} netUnit=${netUnit.toFixed(6)}`
      );
    }

    return pins;
  }

  /**
   * Write the resolved pins as cart-scoped `specific_prices` over the
   * Webservice — the fallback for a shop whose module predates #2597, and two
   * requests per line.
   *
   * Records created ids into `createdIds` so the caller can delete them.
   */
  private async postLinePins(
    pins: ImportOrderLinePrice[],
    externalCartId: string | number,
    externalCustomerId: string | number,
    externalCurrencyId: number | undefined,
    createdIds: Array<string | number>
  ): Promise<void> {
    const toExpiry = this.formatPsDateTime(new Date(Date.now() + ONE_DAY_MS));

    for (const pin of pins) {
      try {
        const createdPrice = await this.httpClient.createResource<{ id: string | number }>(
          'specific_prices',
          {
            // Stringified because that is the shape this resource has always
            // been sent, and the Webservice XML is untyped either way.
            id_product: String(pin.idProduct),
            id_product_attribute: pin.idProductAttribute,
            id_shop: 0,
            id_shop_group: 0,
            id_cart: externalCartId,
            id_currency: externalCurrencyId ?? 0,
            id_country: 0,
            id_group: 0,
            id_customer: externalCustomerId,
            from_quantity: 1,
            price: pin.price,
            reduction: '0',
            reduction_type: 'amount',
            reduction_tax: '0',
            from: '0000-00-00 00:00:00',
            to: toExpiry,
          }
        );
        if (createdPrice?.id !== undefined) {
          createdIds.push(createdPrice.id);
        }
      } catch (error) {
        // Fail loudly (createOrder invariant, ADR-014): do NOT let the order be
        // created at the catalog price. Throw so the idempotency-guarded retry
        // re-attempts; the caller's catch cleans up any pins created so far.
        // Surface the upstream PrestaShop body (the real validation reason lives
        // in `responseBody`, not `message`) — capped via `formatBodyForLog` (#923).
        const detail =
          error instanceof PrestashopApiException && error.responseBody
            ? `${error.message} — ${formatBodyForLog(error.responseBody)}`
            : error instanceof Error
              ? error.message
              : String(error);
        throw new PrestashopApiException(
          `Failed to pin source-authoritative price for product ${pin.idProduct}: ${detail}`,
          undefined,
          undefined
        );
      }
    }
  }

  /**
   * Build the exception a caller gets when the destination tax rate is unknown
   * and the buyer-paid gross must be converted to net (#2052).
   *
   * **The message is interface copy, not a log line.** `OrderSyncService`
   * stores `exception.message` verbatim in `syncStatus[].error`, and the
   * frontend renders that string in three places with no translation layer:
   *
   * | Surface | Budget |
   * |---|---|
   * | orders list, Status sub-line (`.orders-status-reason`) | CSS-clipped at 220 px, ~40 characters; full text only in `title=` |
   * | order detail, failed-destination banner | 160 characters |
   * | order detail, Activity timeline | none |
   *
   * The tightest of the three is the *triage* surface, so the product identity
   * leads the sentence — an operator scanning the list has to know WHICH
   * product before knowing what is wrong with it. The product NAME is
   * deliberately left out in favour of the SKU and the PrestaShop product
   * number: those are the two identifiers that lead to the right record in the
   * shop's admin, and a name can eat the whole visible budget on its own.
   * (The 60-character truncation in the jobs list is NOT one of these budgets:
   * a per-destination create failure never reaches a sync job — see
   * `OrderSyncService.syncOrder`, which re-throws only
   * `OrderCreateContendedException`.)
   *
   * The exception CLASS carries the retry decision (see
   * `PrestashopRetryClassifierAdapter`): a `configuration` unknown will not fix
   * itself, so it raises the non-retryable
   * `PrestashopTaxRateUnknownException`; a `transport` unknown is a failed call
   * to PrestaShop and stays a retryable `PrestashopApiException`, carrying the
   * status code the resolver saw so it still classifies downstream.
   */
  private taxRateUnknownError(
    resolution: PrestashopTaxRateUnknown,
    currency: string,
    grossUnit: number,
    externalProductId: string | number,
    sku: string | undefined
  ): Error {
    const productLabel = sku
      ? `PrestaShop product #${externalProductId} (${sku})`
      : `PrestaShop product #${externalProductId}`;

    if (resolution.reason === 'transport') {
      return new PrestashopApiException(
        `${productLabel}: tax rate could not be read - ${resolution.evidence}. ` +
          `No order was created; the sync job retries on its own.`,
        resolution.statusCode,
        undefined,
        this.connection.id
      );
    }

    return new PrestashopTaxRateUnknownException(
      `${productLabel}: tax rate unknown - ${resolution.evidence}. Refusing to pin ` +
        `${currency} ${grossUnit.toFixed(2)} gross as net; no order was created. ` +
        `Fix the tax configuration in PrestaShop, then retry.`,
      externalProductId,
      this.connection.id
    );
  }

  /**
   * Best-effort deletion of the cart-scoped `specific_prices` rows created by
   * {@link pinLinePrices}. Never throws — the rows are cart-scoped (harmless to
   * other carts) and carry a short `to`-expiry, so a failed delete degrades to
   * a short-lived orphan, not a correctness problem.
   */
  private async cleanupPinnedPrices(ids: Array<string | number>): Promise<void> {
    for (const id of ids) {
      try {
        await this.httpClient.deleteResource('specific_prices', id);
      } catch (error) {
        this.logger.warn(
          `Failed to delete pinned specific_price ${id} (will self-expire): ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /** Format a `Date` as PrestaShop's `YYYY-MM-DD HH:MM:SS` (UTC). */
  private formatPsDateTime(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return (
      `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
      `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    );
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
      const targetStateId = await this.resolveStateId(status);

      // B. Tracking FIRST (when supplied) — so the state-email below renders the
      //    tracking link, and a failure here aborts before the irreversible email.
      if (trackingNumber) {
        await this.writeTracking(externalOrderId, trackingNumber);
      }

      // A. State transition LAST — the single irreversible side-effect.
      await this.applyOrderStateTransition(
        externalOrderId,
        Number(order.current_state),
        targetStateId,
        status
      );
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
   * `OrderStatusWriteback` (#1158 / ADR-027): the single event-as-data writeback
   * the lifecycle relay dispatches through. Delegates to the same internals as
   * `updateFulfillment` (state transition + tracking + state-email), mapping each
   * neutral lifecycle event onto PrestaShop's order state. `OrderFulfillmentUpdater`
   * is retained for OL-driven order provisioning, outside the relay path.
   *
   * The outcome is reported via `OrderWritebackResult` (never thrown): a
   * `cancelled` event against an order PrestaShop has already shipped/delivered is
   * `rejected` — the shop is authoritative for its own live state, so we surface
   * the conflict rather than force a regressive transition.
   */
  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    try {
      if (event.type === 'dispatched') {
        await this.updateFulfillment({
          externalOrderId: event.externalOrderId,
          status: 'shipped',
          trackingNumber: event.trackingNumber,
        });
        return { outcome: 'applied' };
      }

      // event.type === 'cancelled' — refuse if the shop already shipped/delivered.
      // One read here; the cancel carries no tracking, so we reuse the fetched
      // state for the transition instead of re-reading via updateFulfillment.
      const order = await this.httpClient.getResource<PrestashopOrder>(
        'orders',
        event.externalOrderId
      );
      const currentStateId = Number(order.current_state);
      // Compared by what the shop's current state MEANS, not against one id
      // (#2607). A shop may well carry several states that ship - "Handed to
      // courier" beside "Shipped" - and an id equality check would refuse the
      // cancel on only one of them and happily cancel a parcel already gone.
      const states = await this.orderStates.load();
      const currentStatus = states.statusOf(order.current_state);
      const cancelledStateId = await this.resolveStateId('cancelled');
      if (currentStatus === 'shipped' || currentStatus === 'delivered') {
        this.logger.warn(
          `PrestaShop order ${event.externalOrderId} already in state ${currentStateId} ` +
            `(shipped/delivered) — refusing cancel writeback (connection: ${this.connection.id})`
        );
        return { outcome: 'rejected', detail: 'order already shipped' };
      }

      await this.applyOrderStateTransition(
        event.externalOrderId,
        currentStateId,
        cancelledStateId,
        'cancelled'
      );
      return { outcome: 'applied' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `OrderStatusWriteback '${event.type}' failed for PrestaShop order ` +
          `${event.externalOrderId}: ${detail} (connection: ${this.connection.id})`,
        error
      );
      return { outcome: 'rejected', detail };
    }
  }

  /**
   * Apply a PrestaShop order-state transition via `order_histories` (+ the
   * `sendmail=1` customer email). Idempotent — skips when the order is already in
   * the target state, so a re-notify never fires a duplicate state email. Shared
   * by `updateFulfillment` (dispatch / provisioning) and the `OrderStatusWriteback`
   * cancel path so the latter doesn't re-fetch the order it already read.
   */
  private async applyOrderStateTransition(
    externalOrderId: string,
    currentStateId: number,
    targetStateId: number,
    status: OrderStatus
  ): Promise<void> {
    if (currentStateId !== targetStateId) {
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
      const order = await this.httpClient.getResource<PrestashopOrder>('orders', externalOrderId);
      const stateId = order.current_state !== undefined ? String(order.current_state) : null;
      const state = stateId !== null ? await this.lookupOrderState(stateId) : null;
      // Lazy carriers fetch: most PS configurations populate `shipping_number`
      // directly on the order when the operator prints the label, so the
      // carriers WS call is unnecessary for the majority of records. Skip
      // it whenever we already have a value — halves PS API pressure at
      // scale without changing observable behaviour.
      const trackingFromOrder = extractTrackingFromOrder(order);
      const trackingNumber =
        trackingFromOrder ??
        extractTrackingFromCarriers(
          await this.httpClient.listResources<PrestashopOrderCarrier>('order_carriers', {
            custom: { id_order: externalOrderId },
          })
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
          `PrestaShop order ${externalOrderId} not found during fulfillment-status read (connection: ${this.connection.id})`
        );
        return { status: null, trackingNumber: null, deliveredAt: null };
      }
      throw error;
    }
  }

  /**
   * Look up an `order_state` row by id. Returns `null` for unknown ids
   * (orphaned `current_state` - treat as "not yet acted" per the mapper's
   * `state === null` branch).
   */
  private async lookupOrderState(stateId: string): Promise<PrestashopOrderState | null> {
    const states = await this.orderStates.load();
    return states.find(stateId);
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
   * Best-effort lookup of an existing PrestaShop order by its `reference`
   * (the OL order number). Returns the first match, or null when none / on
   * error. Dedup net on the validateOrder create path (ADR-016 / #905): a job
   * retry that rebuilds the cart gets a new `id_cart`, so the endpoint's
   * cart-keyed idempotency can't see the prior order — this reference check
   * (plus Step 0's identifier-mapping guard) prevents a duplicate. Never
   * throws: a lookup failure falls through to create.
   */
  private async findExistingOrderByReference(reference: string): Promise<PrestashopOrder | null> {
    try {
      const rows = await this.httpClient.listResources<PrestashopOrder>(
        'orders',
        { custom: { reference } },
        1,
        0
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (err) {
      this.logger.warn(
        `Order reference lookup failed for reference=${reference}: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
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

  /**
   * Resolve the PrestaShop `id_order_state` for an OL `OrderStatus` (#862).
   *
   * Resolution chain (mirrors `resolveExternalCarrierId`):
   *   1. `MappingConfigService.resolveOrderStateMapping(this.connection.id, status)`
   *      — operator override for THIS destination connection.
   *   2. the shop's own order-state catalogue, matched on what each state
   *      MEANS (#2607) - so a vanilla shop needs no config and a shop with
   *      custom states is no longer written a default-install id.
   *
   * Destination-scoped: the override belongs to this PrestaShop connection's
   * customised state catalogue (`this.connection.id`), NOT the source — unlike
   * the source-scoped carrier/status mappings. Consumed by both `createOrder`
   * (initial state on import) and `updateFulfillment` (the `sendmail` transition
   * whose wrong-id blast radius motivated this).
   */
  private async resolveStateId(status: OrderStatus): Promise<number> {
    if (this.mappingConfigService) {
      const mapped = await this.mappingConfigService.resolveOrderStateMapping(
        this.connection.id,
        status
      );
      if (mapped !== null) {
        const parsed = Number.parseInt(mapped, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          this.logger.debug(
            `Resolved order-state mapping: status='${status}' → id_order_state=${parsed} ` +
              `(destinationConnectionId=${this.connection.id})`
          );
          return parsed;
        }
        this.logger.warn(
          `Order-state mapping resolved to non-positive "${mapped}" for status='${status}' ` +
            `(connection ${this.connection.id}) — ignoring; falling back to default-install map.`
        );
      }
    }
    const states = await this.orderStates.load();
    const derived = states.stateIdFor(status);
    if (derived === null) {
      // Refusing beats writing a guessed id. A state write moves a real order
      // and can send the buyer an email, so the wrong state is worse than a
      // failed job the operator can see and fix (#2607).
      throw new PrestashopOrderStateUnresolvedException(status, this.connection.id);
    }
    this.logger.debug(
      `Derived order state from the shop's catalogue: status='${status}' -> ` +
        `id_order_state=${derived} (connection=${this.connection.id})`
    );
    return derived;
  }

  /**
   * Warn when the source says the buyer has not paid yet but the state the
   * order is about to be imported into makes PrestaShop book it as settled
   * (#2600 review).
   *
   * `amount_paid` cannot express "nothing has arrived". PrestaShop starts
   * `total_paid_real` at 0 and raises it only from `addOrderPayment`, which
   * `PaymentModule::validateOrder` calls only for a `logable` state. So on a
   * non-logable state the figure is already 0 whatever OpenLinker sends, and on
   * a logable state an amount that differs from the cart total makes
   * validateOrder discard the requested state and use "Payment error" instead.
   * Sending 0 therefore never records an unpaid order correctly; it only turns
   * a correct state into a wrong one.
   *
   * What actually decides the outcome is the state, and the state is the
   * operator's to choose - it comes from their own order-state mapping, or from
   * the shop's catalogue when they have not mapped it. OpenLinker will not
   * silently move an order somewhere else than asked, so it reports the
   * mismatch instead of hiding it.
   */
  private async warnIfUnpaidOrderBooksAsSettled(
    order: OrderCreate,
    stateId: number
  ): Promise<void> {
    if (order.paymentStatus !== 'cod' && order.paymentStatus !== 'awaiting') {
      return;
    }
    let state: PrestashopOrderState | null;
    try {
      state = await this.lookupOrderState(String(stateId));
    } catch {
      // The catalogue read is already logged where it fails, and an
      // observability warning must never be the thing that fails an import.
      return;
    }
    if (state === null || !isTruthyStateFlag(state.logable)) {
      return;
    }
    this.logger.warn(
      `Order will be booked as settled although the source reports it unpaid: ` +
        `paymentStatus='${order.paymentStatus}' orderNumber=${order.orderNumber ?? 'N/A'} ` +
        `id_order_state=${stateId} value=${order.totals.total}. That state counts as a real ` +
        `sale in PrestaShop, so the shop records the full value as received. Map this status to ` +
        `a state that does not count as a sale (for example "Awaiting cash on delivery ` +
        `validation") on this connection to record it as outstanding ` +
        `(connection: ${this.connection.id}).`
    );
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

  /**
   * Every order state the shop has, each carrying the neutral status OpenLinker
   * derives for it (#2607).
   *
   * `derivedValue` is what makes this list actionable rather than decorative.
   * A state with none is a state OpenLinker cannot read, so an order sitting in
   * it reads `pending` and a status write will never target it - which is
   * precisely the row an operator needs to map by hand. Reading through the
   * catalogue also guarantees the list agrees with what the write path does,
   * instead of describing it from a second copy of the rules.
   */
  async listOrderStatuses(): Promise<MappingOption[]> {
    const states = await this.orderStates.load();
    return states.all().map((row) => {
      const option: MappingOption = {
        value: String(row.id),
        label: this.flattenLanguageField(row.name),
      };
      const derived = states.statusOf(row.id);
      if (derived !== null) {
        option.derivedValue = derived;
      }
      return option;
    });
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
