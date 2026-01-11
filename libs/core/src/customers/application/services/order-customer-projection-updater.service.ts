/**
 * Order Customer Projection Updater Service
 *
 * Service for updating customer projections from order data. Extracts customer
 * and address information from orders and updates projections accordingly.
 * Handles PII toggle logic and ensures projections are kept in sync with order data.
 *
 * @module libs/core/src/customers/application/services
 */
import { Injectable, Inject } from '@nestjs/common';
import { Order } from '@openlinker/core/orders';
import { ICustomerProjectionService, CUSTOMER_PROJECTION_SERVICE_TOKEN } from '../interfaces/customer-projection.service.interface';
import { CustomerAddressProjection } from '../../domain/entities/customer-address-projection.entity';
import { CustomerProjectionException } from '../../domain/exceptions/customer-projection.exception';
import { getPiiConfig } from '@openlinker/shared/config';
import { hashAddress, normalizeAddress } from '@openlinker/shared/config';

/**
 * Order Customer Projection Updater Service
 *
 * Updates customer projections from order data. Extracts customer information
 * (email, name) and address information (shipping, billing) from orders and
 * updates projections accordingly.
 */
@Injectable()
export class OrderCustomerProjectionUpdaterService {
  constructor(
    @Inject(CUSTOMER_PROJECTION_SERVICE_TOKEN)
    private readonly customerProjectionService: ICustomerProjectionService,
  ) {}

  /**
   * Update customer projections for an order
   *
   * Extracts customer and address data from the order and updates projections.
   * Handles PII toggle logic: if PII storage is disabled, only hashes are stored.
   *
   * @param order - Unified order with internal IDs
   * @param internalCustomerId - Internal customer ID (from identity resolution)
   * @param sourceConnectionId - Source connection ID (where order originated)
   */
  async updateProjectionsForOrder(
    order: Order,
    internalCustomerId: string,
    _sourceConnectionId: string,
  ): Promise<void> {
    // Validate customer ID
    if (!internalCustomerId || internalCustomerId.trim() === '') {
      throw new CustomerProjectionException(
        'Internal customer ID is required for projection updates',
        internalCustomerId,
        'internalCustomerId',
      );
    }

    const piiConfig = getPiiConfig();
    const now = new Date();

    // Note: Customer projection (email, name) should be updated during identity resolution.
    // This service focuses on address projections from order data.

    // Calculate shipping address hash once (reused for billing comparison)
    let shippingHash: string | null = null;
    if (order.shippingAddress) {
      const normalizedAddress = normalizeAddress({
        address1: order.shippingAddress.address1,
        address2: order.shippingAddress.address2,
        city: order.shippingAddress.city,
        postcode: order.shippingAddress.postalCode,
        countryIso2: order.shippingAddress.country,
      });

      shippingHash = hashAddress(normalizedAddress);

      const shippingAddressProjection = new CustomerAddressProjection(
        internalCustomerId,
        shippingHash,
        'shipping',
        piiConfig.storePii ? normalizedAddress.address1 : null,
        piiConfig.storePii ? (normalizedAddress.address2 ?? null) : null,
        piiConfig.storePii ? normalizedAddress.city : null,
        piiConfig.storePii ? (normalizedAddress.postcode ?? null) : null,
        piiConfig.storePii ? normalizedAddress.countryIso2 : null,
        now, // lastSeenAt
        now, // createdAt
        now, // updatedAt
      );

      await this.customerProjectionService.upsertAddressProjection(shippingAddressProjection);
    }

    // Update billing address projection (if different from shipping)
    if (order.billingAddress) {
      const normalizedAddress = normalizeAddress({
        address1: order.billingAddress.address1,
        address2: order.billingAddress.address2,
        city: order.billingAddress.city,
        postcode: order.billingAddress.postalCode,
        countryIso2: order.billingAddress.country,
      });

      const addressHash = hashAddress(normalizedAddress);

      // Only create billing projection if it's different from shipping
      if (addressHash !== shippingHash) {
        const billingAddressProjection = new CustomerAddressProjection(
          internalCustomerId,
          addressHash,
          'billing',
          piiConfig.storePii ? normalizedAddress.address1 : null,
          piiConfig.storePii ? (normalizedAddress.address2 ?? null) : null,
          piiConfig.storePii ? normalizedAddress.city : null,
          piiConfig.storePii ? (normalizedAddress.postcode ?? null) : null,
          piiConfig.storePii ? normalizedAddress.countryIso2 : null,
          now, // lastSeenAt
          now, // createdAt
          now, // updatedAt
        );

        await this.customerProjectionService.upsertAddressProjection(billingAddressProjection);
      }
    }
  }
}
