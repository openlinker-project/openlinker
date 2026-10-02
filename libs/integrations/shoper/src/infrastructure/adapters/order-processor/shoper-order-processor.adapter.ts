/**
 * Shoper Order Processor Adapter
 *
 * Implements `OrderProcessorManagerPort` for Shoper. SKELETON: only the user
 * resolution an order will need exists (`resolveCustomer`); `createOrder`
 * arrives with the header + lines slice and throws `ShoperNotSupportedException`
 * until then, so a connection that enables the capability fails loudly instead
 * of silently dropping orders.
 *
 * The buyer email comes from `order.metadata.buyerEmail`, which
 * `OrderSyncService` fills from the source order's `customerEmail` (#948) - the
 * WooCommerce adapter reads it the same way. It is absent in hash-only PII mode.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/order-processor
 * @implements {OrderProcessorManagerPort}
 */
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { OrderCreate, OrderProcessorManagerPort, OrderRef } from '@openlinker/core/orders';

import { ShoperNotSupportedException } from '../../../domain/exceptions/shoper-not-supported.exception';
import type { ShoperHttpClient } from '../../http/shoper-http-client';
import type { ShoperCustomerProvisioner } from '../../provisioners/shoper-customer.provisioner';

/** RFC-5322-lite: enough to refuse an obviously unusable value. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ShoperOrderProcessorAdapter implements OrderProcessorManagerPort {
  constructor(
    private readonly client: ShoperHttpClient,
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly customerProvisioner: ShoperCustomerProvisioner,
    private readonly connectionId: string,
  ) {}

  createOrder(_order: OrderCreate): Promise<OrderRef> {
    return Promise.reject(new ShoperNotSupportedException('createOrder'));
  }

  /** The Shoper `user_id` the order must reference; used by `createOrder` in the next slice. */
  resolveCustomer(order: OrderCreate): Promise<string> {
    const rawEmail = order.metadata?.buyerEmail;
    const buyerEmail =
      typeof rawEmail === 'string' && EMAIL_PATTERN.test(rawEmail.trim()) ? rawEmail.trim() : undefined;
    return this.customerProvisioner.resolveOrCreateCustomer({
      internalCustomerId: order.customerId,
      buyerEmail,
      firstName: order.billingAddress?.firstName ?? order.shippingAddress?.firstName ?? '',
      lastName: order.billingAddress?.lastName ?? order.shippingAddress?.lastName ?? '',
      connectionId: this.connectionId,
      client: this.client,
      identifierMapping: this.identifierMapping,
    });
  }
}
