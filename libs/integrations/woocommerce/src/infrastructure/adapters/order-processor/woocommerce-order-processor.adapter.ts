/**
 * WooCommerce Order Processor Adapter
 *
 * Implements OrderProcessorManagerPort (createOrder), the OrderFulfillmentUpdater
 * sub-capability (updateFulfillment — status updates, cancellations, refund transitions),
 * the OrderStatusWriteback sub-capability (write — the #1157 / ADR-027 lifecycle
 * relay contract), the DestinationOptionsReader sub-capability (listCarriers /
 * listOrderStatuses / listPaymentMethods — the #472 / #1551 mapping-UI option
 * vocabulary), and the FulfillmentStatusReader sub-capability (getFulfillmentStatus
 * — the #834 / #1550 read-back of the shop's fulfillment view) for WooCommerce REST
 * API v3.
 *
 * Key design decisions:
 * - createOrder: the adapter does NOT dedup. It POSTs to WC and returns the
 *   WC-native order id (#877). The `_ol_order_id` meta_data it stamps is a
 *   forensic/recovery marker only (WC REST cannot filter orders by meta_data
 *   without an extension, so it cannot be read back as a skip-check). Real
 *   idempotency is core-owned: OrderSyncService's per-(order,destination) lock
 *   (#906) + update-or-create mapping check (#909).
 * - Customer provisioning: delegated to WooCommerceCustomerProvisioner
 *   (resolve-or-create under a distributed lock; #1552). Auth failures (401/403)
 *   propagate as WooCommerceAuthFailureException — they are NOT swallowed into
 *   guest-order creation (#877).
 * - buyerEmail: WooCommerce adapter reads buyer email from order.metadata?.buyerEmail,
 *   which OrderSyncService populates from the source order's customerEmail (#948).
 *   When absent (hash-only PII mode, or a source without an email), customer
 *   provisioning degrades to guest (customer_id = 0).
 * - Address reuse: delegated to WooCommerceAddressProvisioner (#1552). WC has no
 *   standalone address resource — the provisioner writes the customer's inline
 *   billing/shipping address at most once per (customer, addressHash, type) using
 *   destination_address_mappings, guarded by the same distributed lock. Best-effort:
 *   a provisioning failure is logged and never aborts order creation. The order
 *   payload always carries the inline address regardless.
 * - Currency + tax (#3470): the create payload always carries `currency`
 *   (refused when the source order has none) and every gross-priced line is
 *   converted to the tax-exclusive amount WC REST expects, using the line's own
 *   ADR-063 `taxRate` — mirrors `PrestashopOrderProcessorManagerAdapter`. The
 *   booked `total` is read back and compared against the buyer-paid total,
 *   warning on drift.
 * - Tax class (#3505): when the store calculates taxes itself
 *   (`woocommerce_calc_taxes = yes`) every line carries the `tax_class` that
 *   gives its own rate, resolved by `WooCommerceTaxClassResolver`; a rate no
 *   class gives refuses the order. A mixed-rate shipping charge goes out as
 *   one taxable fee line per rate. With store taxes off the payload is
 *   unchanged.
 * - Payment status (#2600 / #3471): `set_paid` is gated on
 *   `order.paymentStatus === 'paid'`, never on `order.status` alone — a
 *   cash-on-delivery order is not settled just because it reached `processing`.
 * - Carrier mapping (#3471): the shipping line's `method_id` is resolved via
 *   `IMappingConfigService.resolveCarrierMapping`, keyed on the source
 *   connection + `order.shipping.methodId` — falls back to WC's `flat_rate`
 *   when unmapped, matching what `listCarriers()` advertises.
 * - Non-idempotent create (#3469): `createOrder`'s `POST /orders` is never
 *   retried by the HTTP client on an ambiguous 5xx/network failure, and a 2xx
 *   response with no `id` raises `WooCommerceOrderCreateAmbiguousException`
 *   (registered non-retryable) rather than being treated as a job-level
 *   retry candidate — both close the same duplicate-order risk.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 * @implements {OrderProcessorManagerPort}
 * @implements {OrderFulfillmentUpdater}
 * @implements {OrderStatusWriteback}
 * @implements {DestinationOptionsReader}
 * @implements {FulfillmentStatusReader}
 */
import type {
  OrderProcessorManagerPort,
  OrderCreate,
  OrderRef,
  OrderItem,
  Address,
  OrderStatus,
} from '@openlinker/core/orders';
import type {
  OrderFulfillmentUpdater,
  OrderStatusWriteback,
  OrderLifecycleEvent,
  OrderWritebackResult,
  DestinationOptionsReader,
  MappingOption,
  FulfillmentStatusReader,
  FulfillmentStatusSnapshot,
} from '@openlinker/core/orders';
import type { IdentifierMappingPort, Connection, ExternalIdMapping } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { CustomerProjectionRepositoryPort, AddressType } from '@openlinker/core/customers';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import { PAYMENT_STATUS, readBuyerTaxId } from '@openlinker/core/orders';
import { taxRatePercentToFraction } from '@openlinker/core/invoicing';
import {
  splitShippingAcrossRates,
  minorUnitExponentFor,
  type ShippingSplitLine,
} from '@openlinker/core/sales-documents';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import { WooCommerceResourceNotFoundException } from '../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceOrderProcessingException } from '../../../domain/exceptions/woocommerce-order-processing.exception';
import { WooCommerceOrderCreateAmbiguousException } from '../../../domain/exceptions/woocommerce-order-create-ambiguous.exception';
import { WooCommerceInvalidArgumentException } from '../../../domain/exceptions/woocommerce-invalid-argument.exception';
import { WooCommerceInvalidIdentifierException } from '../../../domain/exceptions/woocommerce-invalid-identifier.exception';
import { toPositiveInt } from '../../utils/woocommerce-utils';
import type { WooCommerceCustomerProvisioner } from '../../provisioners/woocommerce-customer-provisioner';
import type { WooCommerceAddressProvisioner } from '../../provisioners/woocommerce-address-provisioner';
import { isSyntheticVariantExternalId } from '../../mappers/woocommerce-variant-id';
import type {
  WooCommerceOrderCreateRequest,
  WooCommerceOrderUpdateRequest,
  WooCommerceOrderResponse,
  WooCommerceOrderAddress,
  WooCommerceLineItemRequest,
  WooCommerceShippingLineRequest,
  WooCommerceFeeLineRequest,
} from './woocommerce-order.types';
import { WooCommerceTaxClassResolver } from './woocommerce-tax-class.resolver';
import type { WooCommerceTaxClassTable } from './woocommerce-tax-class.types';
import { WC_ORDER_STATUS_MAP, WC_ORDER_STATUS_VALUES } from './woocommerce-order.types';
import {
  WC_ORDER_STATUS_LABELS,
  type WooCommercePaymentGateway,
  type WooCommerceShippingMethod,
} from './woocommerce-options.types';
import { mapToFulfillmentStatusSnapshot } from './woocommerce-fulfillment-status.mapper';
import { WOOCOMMERCE_VAT_META_KEY_ALLOWLIST } from '../woocommerce-order-source.adapter';

// ─── Module-level pure helpers ────────────────────────────────────────────────
// Pure functions with no dependency on adapter state — independently testable.

/**
 * RFC-5322-lite email format guard.
 * Uses typeof before the regex to satisfy strict null checks without a cast.
 */
export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * WC's built-in "Flat rate" shipping method — the pre-#3471 hardcoded
 * default, retained as the fallback `method_id` when no carrier mapping
 * resolves one (#3471). Also one of `listCarriers()`'s returned values, so
 * the fallback is always a real, valid WC method.
 */
const DEFAULT_SHIPPING_METHOD_ID = 'flat_rate';

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class WooCommerceOrderProcessorAdapter
  implements
    OrderProcessorManagerPort,
    OrderFulfillmentUpdater,
    OrderStatusWriteback,
    DestinationOptionsReader,
    FulfillmentStatusReader
{
  private readonly logger = new Logger(WooCommerceOrderProcessorAdapter.name);

  constructor(
    private readonly httpClient: IWooCommerceHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connection: Connection,
    private readonly customerProvisioner: WooCommerceCustomerProvisioner,
    private readonly addressProvisioner: WooCommerceAddressProvisioner,
    private readonly customerProjectionRepository: CustomerProjectionRepositoryPort,
    // Optional (#3471): resolves the operator-configured carrier mapping for
    // the shipping line. Absent in the static/unit-test construction path
    // (`createWooCommercePlugin()` with no deps) — carrier resolution then
    // falls back to the pre-#3471 hardcoded default.
    private readonly mappingConfigService?: IMappingConfigService,
    // #3505 — the store's tax classes, read once per adapter instance. A
    // parameter only so a spec can hand in a stub; production uses the default.
    private readonly taxClassResolver: WooCommerceTaxClassResolver = new WooCommerceTaxClassResolver(
      httpClient,
    ),
  ) {}

  // ─── OrderProcessorManagerPort ────────────────────────────────────────────

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    this.logger.debug(
      `createOrder: status=${order.status} items=${order.items.length} (connection: ${this.connection.id})`,
    );

    // Step 0 — refuse an order that carries no currency, before any WC write
    // (#3470, mirrors PrestashopOrderProcessorManagerAdapter's Step 0). With
    // no `currency` on the payload WC stamps the store's own default
    // currency, so a EUR/CZK order would otherwise book under the wrong
    // denomination with the same numerals.
    const currencyCode = (order.totals.currency ?? '').trim();
    if (currencyCode === '') {
      throw new WooCommerceOrderProcessingException(
        `Order ${order.orderNumber || '(no reference)'}: no currency — the source order ` +
          `carries no ISO 4217 code, so its WooCommerce currency cannot be set. No order ` +
          `was created.`,
        this.connection.id,
      );
    }

    // Step 1 — extract and validate buyer email from order metadata.
    // OrderSyncService populates metadata.buyerEmail from the source order's
    // customerEmail (#948); absent in hash-only PII mode or emailless sources.
    const rawEmail = order.metadata?.buyerEmail;
    const buyerEmail = isValidEmail(rawEmail) ? rawEmail : undefined;
    if (!buyerEmail) {
      this.logger.debug(
        `createOrder: billing.email absent or invalid — WC order confirmation will not be sent`,
      );
    }

    // Step 2 — resolve or provision WC customer (delegated to the provisioner,
    // which serializes concurrent provisioning for the same buyer under a lock).
    const firstName = order.billingAddress?.firstName ?? order.shippingAddress?.firstName ?? '';
    const lastName = order.billingAddress?.lastName ?? order.shippingAddress?.lastName ?? '';
    const customerId = await this.customerProvisioner.resolveOrCreateCustomer({
      internalCustomerId: order.customerId,
      buyerEmail,
      firstName,
      lastName,
      connectionId: this.connection.id,
      httpClient: this.httpClient,
      identifierMapping: this.identifierMapping,
    });

    // Step 2b — reuse-tracked address provisioning (best-effort; #1552). Records
    // the WC customer's inline billing/shipping address for reuse without ever
    // aborting order creation. Skipped for guest orders (customer_id = 0).
    if (customerId > 0 && order.customerId) {
      await this.provisionAddresses(order, order.customerId, customerId);
    }

    // Step 2c — the store's tax classes (#3505). `null` = WooCommerce does not
    // calculate taxes, and the payload stays exactly as it was before.
    const taxClasses = await this.taxClassResolver.load();

    // Step 3 — resolve line items (throws on any unresolvable or corrupted
    // mapping, or on a gross-priced line with no resolvable tax rate — #3470,
    // or on a rate no store tax class gives — #3505).
    const lineItems = await this.resolveLineItems(order, taxClasses);

    // Step 4 — build shipping lines, resolving the operator's carrier mapping
    // (#3471) — mirrors PrestaShop's resolveExternalCarrierId. A mixed-rate
    // shipping charge on a tax-calculating store comes back as fee lines.
    const { shippingLines, feeLines } = await this.buildShippingCharges(order, taxClasses);

    // Step 5 — build WC order payload.
    // _ol_order_id is a forensic/recovery marker only — NOT a dedup guard. WC REST
    // cannot filter orders by meta_data without an extension, so the adapter cannot
    // (and must not) read it back to skip a duplicate. Real idempotency is owned by
    // core's OrderSyncService — the per-(order,destination) lock (#906) plus the
    // update-or-create mapping check (#909). The marker only lets operators or
    // recovery tooling identify the WC order an OL order produced when a response is
    // lost after a successful POST.
    const internalOrderId = order.metadata?.internalOrderId;

    // Gate set_paid on the source's own payment-status statement, never on
    // `order.status` (#2600 / #3471): a cash-on-delivery order settled by the
    // buyer on receipt is not paid yet just because it reached `processing`,
    // and WC's `set_paid: true` forces the order into a paid state and stamps
    // `date_paid` — the shop's books would show it as settled prematurely.
    // Absent `paymentStatus` (source doesn't report it) also does not mark
    // paid — the conservative direction when the fact is unknown.
    const markPaid = order.paymentStatus === PAYMENT_STATUS.Paid;

    const metaData = this.buildOrderMetaData(order, internalOrderId);

    const payload: WooCommerceOrderCreateRequest = {
      status: WC_ORDER_STATUS_MAP[order.status],
      customer_id: customerId,
      billing: {
        ...this.mapAddress(order.billingAddress),
        ...(buyerEmail ? { email: buyerEmail } : {}),
      },
      shipping: this.mapAddress(order.shippingAddress),
      line_items: lineItems,
      ...(shippingLines.length > 0 ? { shipping_lines: shippingLines } : {}),
      ...(feeLines.length > 0 ? { fee_lines: feeLines } : {}),
      payment_method: 'other',
      payment_method_title: 'External',
      currency: currencyCode,
      ...(markPaid ? { set_paid: true } : {}),
      ...(metaData.length > 0 ? { meta_data: metaData } : {}),
    };

    // Step 6 — create WC order; return WC-native id as orderId (#877 B2).
    // Identifier-mapping (OL idempotency) and order-mapping writes are owned by
    // OrderSyncService — not the adapter's concern.
    //
    // Non-idempotent by construction (#3469): the underlying `post` defaults
    // to no ambiguous-failure retry, so a lost 5xx/network response here
    // surfaces once rather than risking a duplicate WC order.
    const raw = await this.httpClient.post<WooCommerceOrderResponse>(
      '/wp-json/wc/v3/orders',
      payload,
    );

    if (raw.id === undefined) {
      // The create may still have succeeded — the response body simply
      // lacked `id` — so this must never be retried blindly (#3469): a
      // retry could book the order a second time. The registered
      // WooCommerceRetryClassifierAdapter marks this exception non-retryable.
      throw new WooCommerceOrderCreateAmbiguousException(this.connection.id);
    }

    this.warnOnTotalMismatch(order, raw);

    return { orderId: String(raw.id), orderNumber: raw.number };
  }

  /**
   * Compares the WC-booked `total` against the buyer-paid `order.totals.total`
   * and warns (never throws — the order already exists) on drift beyond a
   * cent of rounding slack (#3470). Read-back only; WC's own `total` is
   * authoritative for what was actually booked.
   */
  private warnOnTotalMismatch(order: OrderCreate, raw: WooCommerceOrderResponse): void {
    if (raw.total === undefined) {
      return;
    }
    const bookedTotal = Number.parseFloat(raw.total);
    if (!Number.isFinite(bookedTotal)) {
      return;
    }
    if (Math.abs(bookedTotal - order.totals.total) > 0.01) {
      this.logger.warn(
        `WooCommerce order ${String(raw.id)} total mismatch: booked=${bookedTotal} ` +
          `${order.totals.currency}, expected=${order.totals.total} ${order.totals.currency} ` +
          `(connection: ${this.connection.id})`,
      );
    }
  }

  // ─── OrderFulfillmentUpdater ──────────────────────────────────────────────

  async updateFulfillment(input: {
    externalOrderId: string;
    status: OrderStatus;
    trackingNumber?: string;
  }): Promise<void> {
    this.logger.debug(
      `updateFulfillment: externalOrderId=${input.externalOrderId} status=${input.status} (connection: ${this.connection.id})`,
    );

    // Path-traversal defence — externalOrderId must be a bare positive integer string
    if (!/^\d+$/.test(input.externalOrderId)) {
      throw new WooCommerceInvalidArgumentException(
        `Invalid externalOrderId "${input.externalOrderId}" — expected a WC integer ID`,
      );
    }

    const wcStatus = WC_ORDER_STATUS_MAP[input.status];
    try {
      await this.httpClient.put<WooCommerceOrderUpdateRequest>(
        `/wp-json/wc/v3/orders/${input.externalOrderId}`,
        { status: wcStatus } satisfies WooCommerceOrderUpdateRequest,
      );
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce order ${input.externalOrderId} not found`,
          CORE_ENTITY_TYPE.Order,
          input.externalOrderId,
          this.connection.id,
        );
      }
      throw err;
    }

    if (input.trackingNumber) {
      // WC core has no tracking field. Future: write to WC Shipment Tracking plugin meta_data.
      this.logger.debug(
        `updateFulfillment: trackingNumber "${input.trackingNumber}" accepted but not persisted (WC has no core tracking field)`,
      );
    }
  }

  // ─── OrderStatusWriteback ─────────────────────────────────────────────────

  /**
   * `OrderStatusWriteback` (#1157 / ADR-027): the single event-as-data writeback
   * the lifecycle relay dispatches through. Maps each neutral lifecycle event
   * onto WooCommerce's order status and PUTs it via `PUT /orders/{id}`.
   *
   * Never throws — the outcome is reported via `OrderWritebackResult`:
   * - `dispatched` → refuse (`rejected`) if WC has already reached a terminal
   *   fulfilled state (`cancelled` / `refunded`) — mirrors the `cancelled`
   *   arm's own terminal-state guard, so a delayed relay can never resurrect
   *   a closed order (#3471). Otherwise set WC status `completed` (delegates
   *   to `updateFulfillment`, the same neutral-`shipped` → WC-`completed`
   *   mapping; skipped when already `completed`). `applied` — unless the
   *   event carried a tracking number, which WC core cannot store: `unsupported`
   *   instead, so the #1947 late-waybill relay marker is not burned on a
   *   waybill the shop never actually received.
   * - `cancelled`  → refuse (`rejected`) if WC has already reached a terminal
   *   fulfilled state (`completed` / `refunded`) — the shop is authoritative for
   *   its own live state, so we surface the conflict rather than force a
   *   regressive transition. Idempotent when already `cancelled`. Otherwise PUT
   *   `cancelled`. `applied`.
   */
  async write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
    try {
      if (!/^\d+$/.test(event.externalOrderId)) {
        return {
          outcome: 'rejected',
          detail: `Invalid externalOrderId "${event.externalOrderId}" — expected a WC integer ID`,
        };
      }

      switch (event.type) {
        case 'dispatched': {
          // Read the shop's current status first (#3471 — mirrors the
          // 'cancelled' branch below): a dispatch relay reaching an order the
          // shop already closed as cancelled/refunded must not resurrect it
          // by forcing 'completed' on top.
          const order = await this.httpClient.get<WooCommerceOrderResponse>(
            `/wp-json/wc/v3/orders/${event.externalOrderId}`,
          );
          const currentStatus = order.status;

          if (currentStatus === 'cancelled' || currentStatus === 'refunded') {
            this.logger.warn(
              `WooCommerce order ${event.externalOrderId} already in terminal state ` +
                `'${currentStatus}' — refusing dispatch writeback (connection: ${this.connection.id})`,
            );
            return { outcome: 'rejected', detail: `order already ${currentStatus}` };
          }

          if (currentStatus !== 'completed') {
            await this.updateFulfillment({
              externalOrderId: event.externalOrderId,
              status: 'shipped',
              trackingNumber: event.trackingNumber,
            });
          }

          if (event.trackingNumber) {
            // WC core has no order-level tracking field (see
            // updateFulfillment) — the status write applied (or was already
            // a no-op at 'completed'), but the waybill itself was never
            // stored. Reporting plain 'applied' here would let the #1947
            // late-waybill relay burn its one-time marker on a tracking
            // number the shop never actually received.
            return {
              outcome: 'unsupported',
              detail:
                'status applied, but WooCommerce core has no tracking field — the tracking number was not stored',
            };
          }

          return { outcome: 'applied' };
        }

        case 'cancelled': {
          // One read to honour the shop's authoritative live state before
          // forcing a regressive transition.
          const order = await this.httpClient.get<WooCommerceOrderResponse>(
            `/wp-json/wc/v3/orders/${event.externalOrderId}`,
          );
          const currentStatus = order.status;

          if (currentStatus === 'completed' || currentStatus === 'refunded') {
            this.logger.warn(
              `WooCommerce order ${event.externalOrderId} already in terminal state ` +
                `'${currentStatus}' — refusing cancel writeback (connection: ${this.connection.id})`,
            );
            return { outcome: 'rejected', detail: `order already ${currentStatus}` };
          }

          if (currentStatus === 'cancelled') {
            this.logger.debug(
              `WooCommerce order ${event.externalOrderId} already cancelled — cancel writeback is a no-op ` +
                `(connection: ${this.connection.id})`,
            );
            return { outcome: 'applied' };
          }

          const wcStatus = WC_ORDER_STATUS_MAP.cancelled;
          await this.httpClient.put<WooCommerceOrderUpdateRequest>(
            `/wp-json/wc/v3/orders/${event.externalOrderId}`,
            { status: wcStatus } satisfies WooCommerceOrderUpdateRequest,
          );
          return { outcome: 'applied' };
        }

        default: {
          // Unreachable in-tree: the binding is the compile break when an
          // `OrderLifecycleEvent` member is added without an arm here (#2286).
          // It returns rather than throwing so a caller compiled against a
          // widened union gets a surfaced no-op, not a `rejected` from the
          // enclosing catch (ADR-055 forward-compat).
          const unhandled: never = event;
          return {
            outcome: 'unsupported',
            detail: `unsupported order lifecycle event: ${JSON.stringify(unhandled)}`,
          };
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `OrderStatusWriteback '${event.type}' failed for WooCommerce order ` +
          `${event.externalOrderId}: ${detail} (connection: ${this.connection.id})`,
        error instanceof Error ? error.stack : undefined,
      );
      return { outcome: 'rejected', detail };
    }
  }

  // ─── DestinationOptionsReader (#472 / #1551) ──────────────────────────────
  //
  // Live option vocabulary powering the connection-mappings UI dropdowns. Each
  // method returns the neutral `MappingOption` shape ({ value, label }); `value`
  // is the stable identifier persisted by mapping config, `label` is the
  // operator-facing string.
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * WooCommerce core has no first-class carrier entity — shipping is modelled as
   * method *types* (`flat_rate`, `free_shipping`, `local_pickup`, plus any
   * plugin-provided types) attached to shipping zones, not named carriers.
   * `GET /shipping_methods` returns those globally-registered method types, which
   * is the closest live analogue to a carrier list and gives the mapping UI a
   * non-empty, stable set to map onto (rather than an empty dropdown). `value` is
   * the WC method id — the same code createOrder emits as `shipping_lines.method_id`.
   */
  async listCarriers(): Promise<MappingOption[]> {
    const rows = await this.httpClient.get<WooCommerceShippingMethod[]>(
      '/wp-json/wc/v3/shipping_methods',
    );
    return rows.map((row) => ({
      value: String(row.id),
      label: row.title ?? String(row.id),
    }));
  }

  /**
   * WooCommerce exposes no dedicated order-status catalogue endpoint — the core
   * status set is fixed by the WC REST API v3 contract. Enumerate the shared
   * vocabulary (`WC_ORDER_STATUS_VALUES`) decorated with display labels; `value`
   * is the WC status slug persisted by mapping config.
   */
  listOrderStatuses(): Promise<MappingOption[]> {
    return Promise.resolve(
      WC_ORDER_STATUS_VALUES.map((slug) => ({
        value: slug,
        label: WC_ORDER_STATUS_LABELS[slug],
      })),
    );
  }

  /**
   * `GET /payment_gateways` lists every payment gateway registered in the store.
   * `value` is the gateway code (`bacs`, `cod`, `paypal`, …) persisted by mapping
   * config; `label` is the operator-facing title. All registered gateways are
   * returned regardless of `enabled` — an operator may legitimately map a source
   * payment method onto a currently-disabled destination gateway.
   */
  async listPaymentMethods(): Promise<MappingOption[]> {
    const rows = await this.httpClient.get<WooCommercePaymentGateway[]>(
      '/wp-json/wc/v3/payment_gateways',
    );
    return rows.map((row) => ({
      value: String(row.id),
      label: row.title ?? String(row.id),
    }));
  }

  // ─── FulfillmentStatusReader ──────────────────────────────────────────────

  /**
   * `FulfillmentStatusReader` (#834 / #1550): read the shop's view of an
   * order's fulfillment progress. GETs `/orders/{id}`, reads the WC `status`,
   * and maps it to the neutral `FulfillmentStatusSnapshot` via
   * {@link mapToFulfillmentStatusSnapshot}.
   *
   * `status` is `null` when the shop has not yet fulfilled the order
   * (`pending` / `processing` / `on-hold` / `failed`) — the branch-1 sync
   * service treats that as "no shipment to project, skip this pass".
   * `trackingNumber` is always `null` (WC core carries no order-level tracking
   * field). `externalOrderId` is the WC-native numeric order id.
   */
  async getFulfillmentStatus(input: {
    externalOrderId: string;
  }): Promise<FulfillmentStatusSnapshot> {
    this.logger.debug(
      `getFulfillmentStatus: externalOrderId=${input.externalOrderId} (connection: ${this.connection.id})`,
    );

    // Path-traversal defence — externalOrderId must be a bare positive integer string.
    if (!/^\d+$/.test(input.externalOrderId)) {
      throw new WooCommerceInvalidArgumentException(
        `Invalid externalOrderId "${input.externalOrderId}" — expected a WC integer ID`,
      );
    }

    try {
      const order = await this.httpClient.get<WooCommerceOrderResponse>(
        `/wp-json/wc/v3/orders/${input.externalOrderId}`,
      );
      return mapToFulfillmentStatusSnapshot(order);
    } catch (err) {
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 404) {
        throw new WooCommerceResourceNotFoundException(
          `WooCommerce order ${input.externalOrderId} not found`,
          CORE_ENTITY_TYPE.Order,
          input.externalOrderId,
          this.connection.id,
        );
      }
      throw err;
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Best-effort reuse-tracked provisioning of the WC customer's inline billing
   * and shipping addresses (#1552). Delegates to WooCommerceAddressProvisioner
   * per address type. Failures are logged and swallowed — address reuse tracking
   * is auxiliary and must never abort order creation.
   */
  private async provisionAddresses(
    order: OrderCreate,
    internalCustomerId: string,
    wcCustomerId: number,
  ): Promise<void> {
    const targets: Array<{ address: Address | undefined; type: AddressType }> = [
      { address: order.billingAddress, type: 'billing' },
      { address: order.shippingAddress, type: 'shipping' },
    ];

    for (const { address, type } of targets) {
      if (!address) continue;
      try {
        await this.addressProvisioner.resolveOrCreateAddress({
          internalCustomerId,
          wcCustomerId,
          address,
          addressType: type,
          connectionId: this.connection.id,
          httpClient: this.httpClient,
          customerProjectionRepository: this.customerProjectionRepository,
        });
      } catch (err) {
        this.logger.warn(
          `provisionAddresses: ${type} address reuse tracking failed for customer ${internalCustomerId} — continuing: ${String(err)}`,
        );
      }
    }
  }

  /**
   * Resolves all order items to WC line items.
   * Throws WooCommerceResourceNotFoundException if any product or variant mapping is missing
   * or contains a corrupted (non-integer) external ID — silent partial orders are not acceptable.
   *
   * N+1 trade-off: calls getExternalIds once per item (product + optionally variant).
   * IdentifierMappingPort has no batch-read method today; acceptable for MVP.
   *
   * **Tax treatment (#3470).** WooCommerce REST stores `line_items.subtotal` /
   * `.total` tax-EXCLUSIVE and computes tax on top from the store's own tax
   * rules. `order.items[].price` is the buyer-paid amount, which per ADR-014
   * is GROSS whenever `order.totals.taxTreatment` is `'inclusive'` or unset
   * (the marketplace default — mirrors
   * `PrestashopOrderProcessorManagerAdapter.resolveLinePins`). Converting it
   * with the line's own `taxRate` (ADR-063) is what keeps the WC-computed
   * gross equal to what the buyer actually paid; skipping this let WC add its
   * own VAT on top of an already-gross price, over-charging the order. A line
   * needing conversion with no resolvable rate throws rather than silently
   * mis-pricing (the ADR-014 `createOrder` invariant) — a wrong order is
   * worse than none, and none has been created yet.
   */
  private async resolveLineItems(
    order: OrderCreate,
    taxClasses: WooCommerceTaxClassTable | null,
  ): Promise<WooCommerceLineItemRequest[]> {
    const items = order.items;
    // `exclusive` → already net, pin as-is. Everything else (`inclusive`/unset)
    // → gross, convert to net. Mirrors PrestaShop's `convertGrossToNet`.
    const convertGrossToNet = order.totals.taxTreatment !== 'exclusive';
    const lineItems: WooCommerceLineItemRequest[] = [];

    for (const item of items) {
      // Resolve product
      const productIds = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Product,
        item.productId,
      );
      const productMapping = productIds.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
      if (!productMapping) {
        throw new WooCommerceResourceNotFoundException(
          `No WC product mapping for OL product ${item.productId} on connection ${this.connection.id}`,
          CORE_ENTITY_TYPE.Product,
          item.productId,
          this.connection.id,
        );
      }
      let productId: number;
      try {
        productId = toPositiveInt(productMapping.externalId, 'product id');
      } catch (err) {
        if (err instanceof WooCommerceInvalidIdentifierException) {
          throw new WooCommerceResourceNotFoundException(
            `Corrupted mapping: "${productMapping.externalId}" is not a valid positive integer WC ID for ${CORE_ENTITY_TYPE.Product} ${item.productId}`,
            CORE_ENTITY_TYPE.Product,
            item.productId,
            this.connection.id,
          );
        }
        throw err;
      }

      // Resolve variant (optional)
      let variationId: number | undefined;
      if (item.variantId) {
        const variantIds = await this.identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.ProductVariant,
          item.variantId,
        );
        const variantMapping = variantIds.find((e: ExternalIdMapping) => e.connectionId === this.connection.id);
        if (!variantMapping) {
          throw new WooCommerceResourceNotFoundException(
            `No WC variant mapping for OL variant ${item.variantId} on connection ${this.connection.id}`,
            CORE_ENTITY_TYPE.ProductVariant,
            item.variantId,
            this.connection.id,
          );
        }
        if (isSyntheticVariantExternalId(variantMapping.externalId)) {
          // Synthetic variant of a simple product (`product:{wcId}` — same
          // convention as PrestaShop; the inventory adapter strips this
          // prefix too). Simple products have no WC variation — the line
          // item is the product itself, so variation_id stays unset.
        } else {
          try {
            variationId = toPositiveInt(variantMapping.externalId, 'variation id');
          } catch (err) {
            if (err instanceof WooCommerceInvalidIdentifierException) {
              throw new WooCommerceResourceNotFoundException(
                `Corrupted mapping: "${variantMapping.externalId}" is not a valid positive integer WC ID for ${CORE_ENTITY_TYPE.ProductVariant} ${item.variantId}`,
                CORE_ENTITY_TYPE.ProductVariant,
                item.variantId,
                this.connection.id,
              );
            }
            throw err;
          }
        }
      }

      // Pin buyer-paid price via subtotal/total. WC REST line_items.price is read-only
      // (reflects catalog price); subtotal/total carry the actual buyer-paid amounts.
      const grossLineAmount = item.price * item.quantity;
      const netLineAmount = convertGrossToNet
        ? grossLineAmount / (1 + this.resolveLineTaxFraction(item))
        : grossLineAmount;
      const lineSubtotal = netLineAmount.toFixed(2);
      const lineTotal = lineSubtotal;
      const taxClass =
        taxClasses !== null && item.taxRate !== undefined
          ? this.resolveTaxClass(
              taxClasses,
              item.taxRate,
              this.taxCountryFor(order, item.taxRateCountry),
              `line ${item.sku ?? item.productId}`,
            )
          : undefined;

      lineItems.push({
        product_id: productId,
        ...(variationId !== undefined ? { variation_id: variationId } : {}),
        quantity: item.quantity,
        subtotal: lineSubtotal,
        total: lineTotal,
        ...(item.name ? { name: item.name } : {}),
        ...(taxClass !== undefined ? { tax_class: taxClass } : {}),
      });
    }

    if (lineItems.length === 0) {
      throw new WooCommerceOrderProcessingException(
        `Cannot create WC order with empty line_items for connection ${this.connection.id}`,
        this.connection.id,
      );
    }

    return lineItems;
  }

  /**
   * Read a line's ADR-063 percent-as-string tax-rate code (`'23'`, `'0'`,
   * `'zw'`, …) as a fraction for gross→net conversion (#3470).
   *
   * `taxRate === undefined` means the rate was never established (never an
   * absence of tax) — throws rather than guessing, mirroring
   * `PrestashopTaxRateUnknownException`'s "fail loudly" precedent (ADR-014 /
   * #2052): pinning `net = gross` there is what let WooCommerce add its own
   * VAT on top and book an order costing more than the buyer paid.
   *
   * A non-numeric exemption code (`'zw'` / `'np'` / `'oo'`) is a real 0% rate,
   * not an absence — `taxRatePercentToFraction` returns `null` for it, which
   * this resolves to `0`.
   */
  private resolveLineTaxFraction(item: OrderItem): number {
    if (item.taxRate === undefined) {
      throw new WooCommerceOrderProcessingException(
        `Cannot create WC order: line ${item.sku ?? item.productId} carries no tax rate and ` +
          `the order is priced gross — converting to the tax-exclusive amount WooCommerce ` +
          `REST expects would require guessing the rate. No order was created.`,
        this.connection.id,
      );
    }
    return taxRatePercentToFraction(item.taxRate) ?? 0;
  }

  /**
   * The store tax class that taxes at exactly `taxRate` in `country` (#3505).
   * Only called when the store calculates taxes: WooCommerce then recomputes
   * the tax from the class, so a line without the right class is booked at
   * the product's class — a 5% line at 23% — and the order total drifts from
   * what the buyer paid. No matching class → refuse rather than book a wrong
   * order (ADR-014, the `resolveLineTaxFraction` precedent).
   */
  private resolveTaxClass(
    taxClasses: WooCommerceTaxClassTable,
    taxRate: string,
    country: string | undefined,
    subject: string,
  ): string {
    const ratePercent = (taxRatePercentToFraction(taxRate) ?? 0) * 100;
    const taxClass = taxClasses.resolve(country, ratePercent);
    if (taxClass === null) {
      throw new WooCommerceOrderProcessingException(
        `Cannot create WC order: ${subject} is taxed at ${taxRate}% but no WooCommerce tax ` +
          `class gives that rate${country ? ` for ${country}` : ''}, and the store calculates ` +
          `taxes itself — the order would be booked at the wrong rate. Add a tax class with ` +
          `that rate in WooCommerce (WooCommerce → Settings → Tax). No order was created.`,
        this.connection.id,
      );
    }
    return taxClass;
  }

  /**
   * The country a rate applies in: the line's own ADR-063 `taxRateCountry`
   * when the source settled one, else where the order ships (WooCommerce's
   * default tax basis), else the billing country.
   */
  private taxCountryFor(order: OrderCreate, rateCountry: string | undefined): string | undefined {
    return rateCountry ?? order.shippingAddress?.country ?? order.billingAddress?.country ?? undefined;
  }

  /**
   * Builds WC shipping lines (or, for a mixed-rate charge on a store that
   * calculates taxes, fee lines — #3505) from order totals. Returns nothing
   * when shipping cost is 0.
   *
   * Resolves the destination `method_id` from the operator's carrier mapping
   * (#3471, mirrors `PrestashopOrderProcessorManagerAdapter.resolveExternalCarrierId`),
   * keyed on the **source** connection + `order.shipping.methodId` — the same
   * scoping convention `resolveCarrierMapping` uses everywhere else. Falls
   * back to the pre-#3471 hardcoded `flat_rate` when no mapping is
   * configured, no `mappingConfigService` was wired (the static/unit-test
   * construction path), or the source carries no `shipping.methodId` at all —
   * `listCarriers()` still advertises `flat_rate` as one of its returned
   * values, so an unmapped method degrades to a real, valid WC method rather
   * than a silently-wrong one.
   *
   * **Tax treatment (#3470 IMPORTANT-2 review).** Shipping is gross-priced
   * exactly like the item lines whenever `taxTreatment` is `'inclusive'`/
   * unset, and WC REST stores `shipping_lines.total` tax-exclusive too — so
   * sending the gross shipping figure let WC add its own VAT on top of it,
   * the same bug #3470 fixed for items. A basket can carry more than one tax
   * rate, so the gross shipping charge is split across the rates present —
   * proportional to each rate's share of gross line value — via the shared
   * `splitShippingAcrossRates` (`@openlinker/core/sales-documents`, ADR-063
   * § 5; this is pure division, never tax computation). Each part is then
   * converted to net with its OWN rate, mirroring `resolveLineTaxFraction`
   * rather than inventing a blended heuristic. A line carrying no tax rate
   * makes the basket's rate mix unresolvable, so the split — and therefore
   * the whole order — refuses, exactly like an unresolvable item line.
   *
   * One WC shipping line is emitted PER RATE PART rather than one blended
   * total: `shipping_lines` is already an array, WC exposes no per-line tax
   * OVERRIDE via REST anyway (`total_tax` is recomputed from the store's own
   * tax settings), so a single blended figure would misrepresent a
   * mixed-rate charge as a single-rate one with no way to say otherwise. The
   * ordinary single-rate case (the overwhelming majority of orders) is
   * unaffected — `splitShippingAcrossRates` returns exactly one part and
   * this still emits exactly one shipping line.
   */
  private async buildShippingCharges(
    order: OrderCreate,
    taxClasses: WooCommerceTaxClassTable | null,
  ): Promise<{
    shippingLines: WooCommerceShippingLineRequest[];
    feeLines: WooCommerceFeeLineRequest[];
  }> {
    if (!order.totals.shipping || order.totals.shipping <= 0) {
      return { shippingLines: [], feeLines: [] };
    }

    const methodId = await this.resolveShippingMethodId(order);
    const methodTitle = order.shipping?.methodName ?? 'Shipping';

    // `exclusive` → shipping is already net, pin as-is (mirrors resolveLineItems).
    if (order.totals.taxTreatment === 'exclusive') {
      return {
        shippingLines: [
          {
            method_id: methodId,
            method_title: methodTitle,
            total: order.totals.shipping.toFixed(2),
          },
        ],
        feeLines: [],
      };
    }

    const splitLines: ShippingSplitLine[] = order.items.map((item) => ({
      taxRate: item.taxRate ?? null,
      gross: item.price * item.quantity,
    }));
    const parts = splitShippingAcrossRates(
      order.totals.shipping,
      splitLines,
      minorUnitExponentFor(order.totals.currency),
    );
    if (parts === null) {
      throw new WooCommerceOrderProcessingException(
        `Cannot create WC order: shipping is gross-priced but the basket's tax-rate mix is ` +
          `unresolvable (at least one line carries no tax rate), so the shipping charge cannot ` +
          `be proportionally split into the tax-exclusive amounts WooCommerce REST expects. ` +
          `No order was created.`,
        this.connection.id,
      );
    }

    const netOf = (part: { amount: number; taxRate: string }): string =>
      (part.amount / (1 + (taxRatePercentToFraction(part.taxRate) ?? 0))).toFixed(2);

    // #3505 (DEC-9) — a store that calculates taxes taxes EVERY shipping line
    // at one class (its shipping tax-class setting), and WC REST takes no
    // `tax_class` on a shipping line. A mixed-rate charge is therefore booked
    // as one taxable FEE line per rate, each pinned to its own class; the
    // carrier's `method_id` is lost for such baskets — the accepted trade-off.
    // A single-rate charge stays an ordinary shipping line.
    if (taxClasses !== null && parts.length > 1) {
      return {
        shippingLines: [],
        feeLines: parts.map((part) => ({
          name: `${methodTitle} (${part.taxRate}%)`,
          tax_class: this.resolveTaxClass(
            taxClasses,
            part.taxRate,
            this.taxCountryFor(
              order,
              order.items.find((item) => item.taxRate === part.taxRate)?.taxRateCountry,
            ),
            `the ${part.taxRate}% share of shipping`,
          ),
          tax_status: 'taxable' as const,
          total: netOf(part),
        })),
      };
    }

    return {
      shippingLines: parts.map((part) => ({
        method_id: methodId,
        // Only decorated with the rate when the basket actually split into
        // more than one part — the single-rate case keeps the plain title
        // every existing order (and test) already expects.
        method_title: parts.length > 1 ? `${methodTitle} (${part.taxRate}%)` : methodTitle,
        total: netOf(part),
      })),
      feeLines: [],
    };
  }

  private async resolveShippingMethodId(order: OrderCreate): Promise<string> {
    const sourceConnectionId = order.source?.connectionId;
    const methodId = order.shipping?.methodId;

    if (this.mappingConfigService && sourceConnectionId && methodId) {
      const mapped = await this.mappingConfigService.resolveCarrierMapping(
        sourceConnectionId,
        methodId,
      );
      if (mapped && mapped.trim().length > 0) {
        this.logger.debug(
          `Resolved carrier mapping: methodId=${methodId} → WC method_id=${mapped} ` +
            `(sourceConnectionId=${sourceConnectionId}, destinationConnectionId=${this.connection.id})`,
        );
        return mapped;
      }
    }

    this.logger.debug(
      `No carrier mapping for methodId=${methodId ?? '<none>'} (sourceConnectionId=` +
        `${sourceConnectionId ?? '<none>'}, destinationConnectionId=${this.connection.id}) — ` +
        `falling back to WC's default 'flat_rate' method.`,
    );
    return DEFAULT_SHIPPING_METHOD_ID;
  }

  /**
   * Maps an OL Address to a WC billing/shipping object. Returns undefined for
   * absent addresses. Nullish fields are OMITTED, not passed through — WC REST
   * type-checks address properties as strings and rejects the whole request
   * with `rest_invalid_param: shipping[company] is not of type string` when a
   * source platform (e.g. Allegro) carries `null` for an optional field.
   *
   * `address.taxId` (the buyer's tax id, #2599) is NOT mapped HERE — WC core's
   * `WooCommerceOrderAddress`/billing/shipping schema has no native tax-id
   * field at all, so there is nowhere on the address object to put it.
   * Decided (#3471 item 5): it is written as order-level `meta_data` instead,
   * under the FIRST key of `WOOCOMMERCE_VAT_META_KEY_ALLOWLIST` — the same
   * list `WooCommerceOrderSourceAdapter` already reads on INGESTION (#2822).
   * Writing under that key (rather than inventing a new one) is what lets an
   * order OL creates round-trip its tax id on the next read of the same shop.
   * See `buildOrderMetaData`, which resolves the value via the shared
   * `readBuyerTaxId` (billing-first, #2599) and omits the entry entirely
   * when the order asserts no tax id (absent or explicitly `null`) — there
   * is nothing to write in either case, and an omitted entry is honest about
   * that, unlike writing an empty string.
   */
  private mapAddress(address: Address | undefined): WooCommerceOrderAddress | undefined {
    if (!address) return undefined;
    const mapped: WooCommerceOrderAddress = {};
    const assign = (key: keyof WooCommerceOrderAddress, value: string | null | undefined): void => {
      if (value !== null && value !== undefined) mapped[key] = value;
    };
    assign('first_name', address.firstName);
    assign('last_name', address.lastName);
    assign('company', address.company);
    assign('address_1', address.address1);
    assign('address_2', address.address2);
    assign('city', address.city);
    assign('state', address.state);
    assign('postcode', address.postalCode);
    assign('country', address.country);
    assign('phone', address.phone);
    return mapped;
  }

  /**
   * Builds the order-level `meta_data` array for `createOrder`'s payload
   * (#3471 item 5): the `_ol_order_id` forensic marker (unchanged), plus the
   * buyer's tax id under the FIRST `WOOCOMMERCE_VAT_META_KEY_ALLOWLIST` key
   * — `readBuyerTaxId` resolves it billing-first (#2599); an entry is
   * emitted ONLY for a real asserted string, never for `undefined`
   * (never asserted) or `null` (asserted to have none) — there is nothing to
   * write for either, and writing e.g. an empty string would be a false
   * positive assertion the source never made.
   */
  private buildOrderMetaData(
    order: OrderCreate,
    internalOrderId: unknown,
  ): Array<{ key: string; value: string }> {
    const metaData: Array<{ key: string; value: string }> = [];
    if (typeof internalOrderId === 'string' && internalOrderId.length > 0) {
      metaData.push({ key: '_ol_order_id', value: internalOrderId });
    }
    const buyerTaxId = readBuyerTaxId(order);
    if (typeof buyerTaxId === 'string' && buyerTaxId.length > 0) {
      metaData.push({ key: WOOCOMMERCE_VAT_META_KEY_ALLOWLIST[0], value: buyerTaxId });
    }
    return metaData;
  }
}
