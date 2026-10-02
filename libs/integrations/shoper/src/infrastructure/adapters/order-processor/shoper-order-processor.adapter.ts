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
 * **No duplicate-order guard here (#3694).** Shoper has no idempotency of its
 * own (SPIKE-3638 O5); until that slice lands, a retried `createOrder` creates a
 * second order. `OrderSyncService` holds the per-(order, destination) lock.
 *
 * **A half-built order is cleaned up, not left.** If a line fails after the
 * header exists, the header is deleted (live: this restores the stock the lines
 * took). If even that fails, `ShoperPartialOrderException` carries the order id
 * for the operator and is terminal - a retry would create a second order.
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
import type { OrderCreate, OrderItem, OrderProcessorManagerPort, OrderRef } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperNotMappedException } from '../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperOrderUnbuildableException } from '../../../domain/exceptions/shoper-order-unbuildable.exception';
import { ShoperPartialOrderException } from '../../../domain/exceptions/shoper-partial-order.exception';
import type { ShoperOrderDefaults } from '../../../domain/types/shoper-config.types';
import type {
  ShoperOrderCreateRequest,
  ShoperOrderProductCreateRequest,
} from '../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import {
  expectedOrderSum,
  findShoperTaxForRate,
  mapShoperOrderAddress,
  resolveGrossUnitPrice,
} from '../../mappers/shoper-order.mapper';
import type { ShoperCustomerProvisioner } from '../../provisioners/shoper-customer.provisioner';
import type { ShoperOrderOptionsProvider } from '../../shop-context/shoper-order-options.provider';
import type { ShoperTaxTableProvider } from '../../shop-context/shoper-tax-table.provider';

/** RFC-5322-lite: enough to refuse an obviously unusable value. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Shoper rounds to cents, so a smaller gap is not a real mismatch. */
const SUM_TOLERANCE = 0.011;

export class ShoperOrderProcessorAdapter implements OrderProcessorManagerPort {
  private readonly logger = new Logger(ShoperOrderProcessorAdapter.name);

  constructor(
    private readonly client: ShoperHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly customerProvisioner: ShoperCustomerProvisioner,
    private readonly taxTable: ShoperTaxTableProvider,
    private readonly options: ShoperOrderOptionsProvider,
    private readonly connection: Connection,
    private readonly mappingConfig?: IMappingConfigService,
  ) {}

  async createOrder(order: OrderCreate): Promise<OrderRef> {
    // Phase 1 - resolve everything; nothing is written yet except the user.
    const prepared = await this.prepare(order);
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

    this.warnOnSumMismatch(order, prepared, orderId);
    return { orderId };
  }

  /** The Shoper `user_id` the order must reference. */
  resolveCustomer(order: OrderCreate): Promise<string> {
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

  // ─── Preparation (no writes) ───────────────────────────────────────────────

  private async prepare(order: OrderCreate): Promise<PreparedOrder> {
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

    const shippingCost = order.totals.shippingGross ?? order.totals.shipping;
    const header: Omit<ShoperOrderCreateRequest, 'user_id'> = {
      email,
      status_id: statusId,
      payment_id: paymentId,
      shipping_id: shippingId,
      shipping_tax_id: shippingTaxId,
      shipping_cost: shippingCost,
      currency_id: Number(currencyId),
      billing_address: mapShoperOrderAddress(billing, phone),
      delivery_address: mapShoperOrderAddress(delivery, phone),
      ...(order.internalOrderId !== undefined ? { notes_priv: `OpenLinker order ${order.internalOrderId}` } : {}),
    };
    return { header, lines, shippingCost };
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

  private warnOnSumMismatch(order: OrderCreate, prepared: PreparedOrder, orderId: string): void {
    const sent = expectedOrderSum(prepared.lines, prepared.shippingCost);
    if (Math.abs(sent - order.totals.total) > SUM_TOLERANCE) {
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

interface PreparedOrder {
  readonly header: Omit<ShoperOrderCreateRequest, 'user_id'>;
  readonly lines: Array<Omit<ShoperOrderProductCreateRequest, 'order_id'>>;
  readonly shippingCost: number;
}

function readBuyerEmail(order: OrderCreate): string | undefined {
  const raw = order.metadata?.buyerEmail;
  return typeof raw === 'string' && EMAIL_PATTERN.test(raw.trim()) ? raw.trim() : undefined;
}

function readDefaults(connection: Connection): ShoperOrderDefaults {
  const raw = (connection.config ?? {}).defaults;
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  return {
    ...(toPositiveInt(record.shippingId) !== null ? { shippingId: toPositiveInt(record.shippingId) as number } : {}),
    ...(toPositiveInt(record.paymentId) !== null ? { paymentId: toPositiveInt(record.paymentId) as number } : {}),
    ...(toPositiveInt(record.statusId) !== null ? { statusId: toPositiveInt(record.statusId) as number } : {}),
  };
}

function requireDefault(value: number | undefined, key: string, label: string, connectionId: string): number {
  if (value === undefined) {
    throw new ShoperOrderUnbuildableException(
      connectionId,
      `no ${label} could be resolved: add a mapping or set connection config "${key}" to the id of a ${label} in the shop`,
    );
  }
  return value;
}

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readId(data: unknown): string | null {
  if (typeof data === 'number' || (typeof data === 'string' && data.trim() !== '')) {
    return String(data);
  }
  return null;
}
