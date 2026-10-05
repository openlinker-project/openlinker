/**
 * Shoper Order Processor Adapter
 *
 * Implements `OrderProcessorManagerPort` for Shoper: resolves the Shoper user
 * (`ShoperCustomerProvisioner`), then creates the order header (`POST /orders`)
 * and one line per item (`POST /order-products`), priced at what the buyer paid
 * (ADR-014). Returns the Shoper-native order id, never an internal id (#909).
 *
 * **Everything is resolved before the first write.** Shoper decrements stock as
 * each line is created, so a failure discovered halfway leaves a half-built
 * order that has already moved stock. Variants, taxes, the three required ids
 * (shipping / payment / status), the currency and the prices are therefore all
 * settled first; the only failures left after the header exists are the shop's
 * own.
 *
 * **Stock (#3695).** Shoper removes stock itself when a line is created. This adapter
 * never writes stock for an order it creates and never compensates.
 *
 * **Idempotency.** Shoper has none of its own (SPIKE-3638 O5). `OrderSyncService`
 * holds the per-(order, destination) lock and skips on a recorded mapping; this
 * adapter closes the window that leaves (created on Shoper, mapping never
 * written) by looking the order up through its `notes_priv` marker first.
 *
 * **A half-built order is cleaned up, not left.** If a line fails after the
 * header exists, the header is deleted (live: this restores the stock the lines
 * took). If even that fails, `ShoperPartialOrderException` carries the order id;
 * the retry finds that header by its marker, deletes it and recreates.
 *
 * The buyer email comes from `order.metadata.buyerEmail` (`OrderSyncService`
 * fills it from the source order's `customerEmail`, #948).
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/order-processor
 * @implements {OrderProcessorManagerPort}
 */
import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type {
  DestinationOptionsReader,
  MappingOption,
  OrderCreate,
  OrderItem,
  OrderProcessorManagerPort,
  OrderRef,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperDuplicateOrderException } from '../../../domain/exceptions/shoper-duplicate-order.exception';
import { ShoperOrderModifiedException } from '../../../domain/exceptions/shoper-order-modified.exception';
import { ShoperNotMappedException } from '../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperOrderUnbuildableException } from '../../../domain/exceptions/shoper-order-unbuildable.exception';
import { ShoperPartialOrderException } from '../../../domain/exceptions/shoper-partial-order.exception';
import type { ShoperOrderDefaults } from '../../../domain/types/shoper-config.types';
import type { PreparedShoperOrder } from '../../../domain/types/shoper-order-prepare.types';
import type {
  ShoperOptionRow,
  ShoperOrderCreateRequest,
  ShoperOrderRef,
  ShoperOrderProductCreateRequest,
} from '../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from '../../http/shoper-pagination';
import {
  expectedOrderSum,
  findShoperTaxForRate,
  labelShoperOption,
  mapShoperOrderAddress,
  resolveGrossUnitPrice,
} from '../../mappers/shoper-order.mapper';
import {
  orderMarker,
  readBuyerEmail,
  readDefaults,
  readId,
  requireDefault,
  toPositiveInt,
} from '../../mappers/shoper-order-input.mapper';
import type { ShoperCustomerProvisioner } from '../../provisioners/shoper-customer.provisioner';
import type { ShoperShopContextProvider } from '../../shop-context/shoper-shop-context.provider';
import type { ShoperOrderOptionsProvider } from '../../shop-context/shoper-order-options.provider';
import type { ShoperTaxTableProvider } from '../../shop-context/shoper-tax-table.provider';

/** Shoper rounds to cents, so a smaller gap is not a real mismatch. */
const SUM_TOLERANCE = 0.011;

export class ShoperOrderProcessorAdapter implements OrderProcessorManagerPort, DestinationOptionsReader {
  private readonly logger = new Logger(ShoperOrderProcessorAdapter.name);

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly customerProvisioner: ShoperCustomerProvisioner,
    private readonly taxTable: ShoperTaxTableProvider,
    private readonly options: ShoperOrderOptionsProvider,
    private readonly shopContext: ShoperShopContextProvider,
    private readonly connection: Connection,
    private readonly mappingConfig?: IMappingConfigService,
    /**
     * Connections already warned that their shop keeps its own stock. Owned by the
     * factory so it spans the per-resolution adapters of ONE plugin instance
     * (a fresh adapter is built per `getCapabilityAdapter` call) without being
     * process-global state.
     */
    private readonly warnedStockFlagConnections: Set<string> = new Set<string>(),
  ) {}

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    // Phase 1 - resolve everything; nothing is written yet except the user.
    const prepared = await this.prepare(order);

    // Shoper has no idempotency of its own (SPIKE-3638 O5), and core's per-order
    // lock only covers the window it can see: a create that succeeded on Shoper
    // whose mapping write then failed leaves a retry with nothing to skip on.
    // The marker we write on every order closes that window (see `recoverExisting`).
    const existing = await this.recoverExisting(
      prepared.marker,
      prepared.lines.length,
      prepared.header.status_id,
    );
    if (existing !== null) {
      return { orderId: existing };
    }


    const userId = await this.resolveCustomer(order);

    // Phase 2 - header, then lines.
    const created = await this.client.post<unknown>('/orders', { ...prepared.header, user_id: Number(userId) });
    const orderId = readId(created.data);
    if (orderId === null) {
      throw new ShoperOrderUnbuildableException(
        this.connection.id,
        'Shoper accepted POST /orders but returned no order id',
      );
    }

    let linesCreated = 0;
    try {
      for (const line of prepared.lines) {
        await this.client.post<unknown>('/order-products', { ...line, order_id: Number(orderId) });
        linesCreated += 1;
      }
    } catch (error) {
      throw await this.rollBack(orderId, linesCreated, prepared.lines.length, error);
    }

    // Diagnostics only: the order already exists, so a failure reading the shop
    // context must not fail (and so retry) a create that succeeded.
    try {
      await this.warnIfShopKeepsStock(order);
    } catch (error) {
      this.logger.debug(
        `Could not check the Shoper stock flag after creating order ${orderId} ` +
          `(connection: ${this.connection.id}): ${String(error)}`,
      );
    }
    this.warnOnSumMismatch(order, prepared, orderId);
    return { orderId };
  }

  /** The Shoper `user_id` the order must reference. */
  private resolveCustomer(order: OrderCreate): Promise<string> {
    return this.customerProvisioner.resolveOrCreateCustomer({
      internalCustomerId: order.customerId,
      buyerEmail: readBuyerEmail(order),
      firstName: order.billingAddress?.firstName ?? order.shippingAddress?.firstName ?? '',
      lastName: order.billingAddress?.lastName ?? order.shippingAddress?.lastName ?? '',
      connectionId: this.connection.id,
      client: this.client,
      identifierMapping: this.identifierMapping,
    });
  }

  // ─── Duplicate recovery ────────────────────────────────────────────────────

  /**
   * An order already created for this marker. Complete -> its id (nothing is
   * written). Incomplete -> deleted ONLY if it is still in the status OpenLinker
   * created it in: that restores the stock its lines took, and null is returned so
   * the caller recreates it (lines already written may be wrong, so a half order is
   * never completed in place). Several -> refused.
   *
   * A line-count mismatch is also what a merchant editing the order looks like, so
   * a mismatch alone never authorises a delete: an order that has since left its
   * creation status is left alone (`ShoperOrderModifiedException`). And an
   * unreadable line count is an error, never "incomplete" - a guard that deletes on
   * a value it could not read would destroy good orders.
   *
   * The status check is best-effort, not atomic with the `DELETE`: the status is read
   * here and the delete is a separate call, and Shoper offers no conditional delete.
   * A merchant who advances the order inside that window loses the guard.
   *
   * "Complete" compares the NUMBER of lines only. An order that changed at the
   * source between two attempts is therefore returned as it stands; `createOrder`
   * does not re-sync content.
   */
  private async recoverExisting(
    marker: string,
    expectedLines: number,
    createdInStatusId: number,
  ): Promise<string | null> {
    // The default page (10) is plenty for an exact marker match; it also caps the
    // ids a duplicate report can name.
    const found = await this.client.get<{ list?: readonly ShoperOrderRef[] }>('/orders', {
      'filters[notes_priv]': marker,
    });
    const rows = (found.data.list ?? []).filter((row) => row.notes_priv === marker);
    if (rows.length === 0) {
      return null;
    }
    if (rows.length > 1) {
      throw new ShoperDuplicateOrderException(
        this.connection.id,
        marker,
        rows.map((row) => String(row.order_id)),
      );
    }

    const orderId = String(rows[0].order_id);
    const lines = await this.client.get<{ count?: string | number }>('/order-products', {
      'filters[order_id]': orderId,
    });
    const count = Number(lines.data.count);
    if (lines.data.count === undefined || lines.data.count === null || !Number.isFinite(count)) {
      throw new ShoperNetworkError(
        `Shoper returned no readable line count for order ${orderId} (${marker}); not deleting it`,
      );
    }
    if (count === expectedLines) {
      this.logger.log(
        `Shoper order ${orderId} already exists for ${marker} (connection: ${this.connection.id}); skipping create`,
      );
      return orderId;
    }

    if (Number(rows[0].status_id) !== createdInStatusId) {
      throw new ShoperOrderModifiedException(
        this.connection.id,
        orderId,
        marker,
        `${count}/${expectedLines} lines and status ${String(rows[0].status_id)} instead of ${createdInStatusId}`,
      );
    }

    this.logger.warn(
      `Shoper order ${orderId} for ${marker} has ${count}/${expectedLines} lines and is still in status ` +
        `${createdInStatusId} (connection: ${this.connection.id}); deleting it and recreating`,
    );
    await this.client.delete(`/orders/${orderId}`);
    return null;
  }

  // ─── Preparation (no writes) ───────────────────────────────────────────────

  private async prepare(order: OrderCreate): Promise<PreparedShoperOrder> {
    if (order.internalOrderId === undefined) {
      // No key means no way to recognise this order on a retry, i.e. an order
      // that can be duplicated for good. Refuse rather than create one.
      throw this.unbuildable('the order has no internalOrderId, which duplicate recovery is keyed on');
    }
    const marker = orderMarker(order.internalOrderId);
    const email = readBuyerEmail(order);
    if (email === undefined) {
      // The same condition the customer provisioner refuses, reported before any lookup.
      throw this.unbuildable('no buyer email on the order');
    }
    if (order.items.length === 0) {
      throw this.unbuildable('the order has no lines');
    }

    const billing = order.billingAddress ?? order.shippingAddress;
    const delivery = order.shippingAddress ?? order.billingAddress;
    if (billing === undefined || delivery === undefined) {
      throw this.unbuildable('the order has no billing or shipping address');
    }

    const phone = billing.phone?.trim() || delivery.phone?.trim();
    if (!phone) {
      throw this.unbuildable('the order has no phone number, which Shoper requires on its addresses');
    }

    const lines = await this.buildLines(order);

    const defaults = readDefaults(this.connection);
    const shippingId = await this.resolveShippingId(order, defaults);
    const statusId = await this.resolveStatusId(order, defaults);
    const paymentId = requireDefault(defaults.paymentId, 'defaults.paymentId', 'payment method', this.connection.id);

    const shippingTaxId = await this.resolveShippingTaxId(shippingId);
    const currencyId = await this.options.getCurrencyId(order.totals.currency);
    if (currencyId === null) {
      throw this.unbuildable(`the shop has no currency "${order.totals.currency}"`);
    }

    const shippingCost = this.resolveShippingCost(order);
    const header: Omit<ShoperOrderCreateRequest, 'user_id'> = {
      email,
      status_id: statusId,
      payment_id: paymentId,
      shipping_id: shippingId,
      shipping_tax_id: shippingTaxId,
      shipping_cost: shippingCost,
      currency_id: Number(currencyId),
      ...(order.paymentStatus === 'paid'
        ? { paid: expectedOrderSum(lines, shippingCost) }
        : {}),
      billing_address: mapShoperOrderAddress(billing, phone),
      delivery_address: mapShoperOrderAddress(delivery, phone),
      notes_priv: marker,
    };
    return { header, lines, shippingCost, marker };
  }

  private async buildLines(order: OrderCreate): Promise<Array<Omit<ShoperOrderProductCreateRequest, 'order_id'>>> {
    const taxes = await this.taxTable.get();
    const lines: Array<Omit<ShoperOrderProductCreateRequest, 'order_id'>> = [];
    for (const item of order.items) {
      const price = resolveGrossUnitPrice(item, order.totals.taxTreatment);
      if (price === null) {
        throw this.unbuildable(
          `line "${item.sku ?? item.id}" is net-priced and the source reported no gross price; ` +
            'Shoper line prices are gross and OpenLinker does not compute tax',
        );
      }
      if (item.taxRate === undefined) {
        throw this.unbuildable(`line "${item.sku ?? item.id}" has no tax rate`);
      }
      const tax = findShoperTaxForRate(taxes, item.taxRate);
      if (tax === null) {
        throw this.unbuildable(`the shop has no tax for rate "${item.taxRate}" (line "${item.sku ?? item.id}")`);
      }

      lines.push({
        product_id: Number(await this.externalId(CORE_ENTITY_TYPE.Product, item.productId)),
        stock_id: Number(await this.externalVariantId(item)),
        price,
        quantity: item.quantity,
        name: item.name ?? item.sku ?? item.id,
        tax: tax.name,
        tax_value: Number(tax.value),
      });
    }
    return lines;
  }

  private async externalVariantId(item: OrderItem): Promise<string> {
    if (item.variantId === undefined) {
      throw new ShoperNotMappedException(item.productId, this.connection.id);
    }
    return this.externalId(CORE_ENTITY_TYPE.ProductVariant, item.variantId);
  }

  private async externalId(entityType: string, internalId: string): Promise<string> {
    const mappings = await this.identifierMapping.getExternalIds(entityType, internalId);
    const mapping = mappings.find((m) => m.connectionId === this.connection.id);
    if (mapping === undefined) {
      throw new ShoperNotMappedException(internalId, this.connection.id);
    }
    return mapping.externalId;
  }

  private async resolveShippingId(order: OrderCreate, defaults: ShoperOrderDefaults): Promise<number> {
    const sourceConnectionId = order.source?.connectionId;
    const methodId = order.shipping?.methodId;
    if (this.mappingConfig !== undefined && sourceConnectionId !== undefined && methodId !== undefined) {
      const mapped = toPositiveInt(await this.mappingConfig.resolveCarrierMapping(sourceConnectionId, methodId));
      if (mapped !== null) {
        return mapped;
      }
    }
    return requireDefault(defaults.shippingId, 'defaults.shippingId', 'shipping method', this.connection.id);
  }

  private async resolveStatusId(order: OrderCreate, defaults: ShoperOrderDefaults): Promise<number> {
    if (this.mappingConfig !== undefined) {
      const mapped = toPositiveInt(await this.mappingConfig.resolveOrderStateMapping(this.connection.id, order.status));
      if (mapped !== null) {
        return mapped;
      }
    }
    return requireDefault(defaults.statusId, 'defaults.statusId', 'order status', this.connection.id);
  }

  private async resolveShippingTaxId(shippingId: number): Promise<number> {
    try {
      return Number(await this.options.getShippingTaxId(shippingId));
    } catch (error) {
      if (error instanceof ShoperApiError && error.isResourceNotFound()) {
        throw this.unbuildable(`the shop has no shipping method ${shippingId}`);
      }
      throw error;
    }
  }

  /**
   * Shoper amounts are gross. Shipping is held to the same rule as the lines: on a
   * net-priced source (`exclusive`) the net `shipping` would be written as gross
   * and under-charge the order by the VAT on shipping, so without the source's own
   * `shippingGross` it is refused (a zero cost needs no gross figure).
   */
  private resolveShippingCost(order: OrderCreate): number {
    const { shippingGross, shipping, taxTreatment } = order.totals;
    if (shippingGross !== undefined) {
      return shippingGross;
    }
    if (taxTreatment === 'exclusive' && shipping > 0) {
      throw this.unbuildable(
        'shipping is net-priced and the source reported no gross shipping; ' +
          'Shoper amounts are gross and OpenLinker does not compute tax',
      );
    }
    return shipping;
  }

  // ─── DestinationOptionsReader (mapping UI) ─────────────────────────────────
  //
  // The operator maps a source delivery method / order state onto one of the
  // shop's own rows; `value` is the Shoper id `createOrder` writes. Payments are
  // listed for the same screen but no mapping is consumed yet: the order carries
  // no payment-method name, so `defaults.paymentId` is the only source.

  listCarriers(): Promise<MappingOption[]> {
    return this.listOptions('/shippings', 'shipping_id', 'shipping_id ASC');
  }

  listOrderStatuses(): Promise<MappingOption[]> {
    return this.listOptions('/statuses', 'status_id', 'status_id ASC');
  }

  listPaymentMethods(): Promise<MappingOption[]> {
    return this.listOptions('/payments', 'payment_id', 'payment_id ASC');
  }

  private async listOptions(
    path: string,
    idKey: 'shipping_id' | 'payment_id' | 'status_id',
    order: string,
  ): Promise<MappingOption[]> {
    const options: MappingOption[] = [];
    for (let page = 1; ; page += 1) {
      const result = await fetchShoperPage<ShoperOptionRow>(this.client, path, {
        page,
        limit: SHOPER_MAX_PAGE_SIZE,
        query: { order },
      });
      for (const row of result.items) {
        const id = row[idKey];
        if (id !== undefined) {
          options.push({ value: String(id), label: labelShoperOption(row, String(id)) });
        }
      }
      if (page >= result.pages) {
        return options;
      }
    }
  }

  // ─── Failure handling ──────────────────────────────────────────────────────

  private async rollBack(
    orderId: string,
    linesCreated: number,
    linesTotal: number,
    cause: unknown,
  ): Promise<Error> {
    try {
      await this.client.delete(`/orders/${orderId}`);
      this.logger.warn(
        `Removed incomplete Shoper order ${orderId} after ${linesCreated}/${linesTotal} lines ` +
          `(connection: ${this.connection.id}): ${String(cause)}`,
      );
      return cause instanceof Error ? cause : new Error(String(cause));
    } catch (deleteError) {
      this.logger.error(
        `Could not remove incomplete Shoper order ${orderId} (connection: ${this.connection.id}): ${String(deleteError)}`,
      );
      return new ShoperPartialOrderException(this.connection.id, orderId, linesCreated, linesTotal, cause);
    }
  }

  /**
   * Stock policy (#3695): Shoper is authoritative for its own decrement. This
   * adapter never writes stock for an order it creates and never compensates;
   * with `shopping_update_stock_on_buy` off the shop keeps its stock unchanged
   * (the owner may run an ERP/WMS that does it), which is worth one warning. Read
   * after the order exists so a failed create costs no extra request.
   */
  private async warnIfShopKeepsStock(order: OrderCreate): Promise<void> {
    const context = await this.shopContext.get();
    if (context.decrementsStockOnOrder) {
      return;
    }
    // Once per connection per process: on a shop that keeps stock elsewhere on
    // purpose this is the normal state, and a warning for every sale is noise.
    const message =
      `Shoper connection ${this.connection.id} has shopping_update_stock_on_buy off: creating order ` +
      `${order.internalOrderId ?? '<unknown>'} did NOT reduce the shop's stock, and OpenLinker does not ` +
      'compensate with a stock write';
    if (this.warnedStockFlagConnections.has(this.connection.id)) {
      this.logger.debug(message);
      return;
    }
    this.warnedStockFlagConnections.add(this.connection.id);
    this.logger.warn(message);
  }

  private warnOnSumMismatch(order: OrderCreate, prepared: PreparedShoperOrder, orderId: string): void {
    const sent = expectedOrderSum(prepared.lines, prepared.shippingCost);
    // A discount the source reports may or may not already be in the line prices
    // (the buyer-paid price usually is), so either reading is a match.
    const accepted = [order.totals.total, order.totals.total + (order.totals.discountTotal ?? 0)];
    if (accepted.every((total) => Math.abs(sent - total) > SUM_TOLERANCE)) {
      this.logger.warn(
        `Shoper order ${orderId} totals ${sent} but the source order totals ${order.totals.total} ` +
          `(connection: ${this.connection.id}) - a discount or rounding the lines do not carry`,
      );
    }
  }

  private unbuildable(reason: string): ShoperOrderUnbuildableException {
    return new ShoperOrderUnbuildableException(this.connection.id, reason);
  }
}
