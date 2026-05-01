/**
 * Order Customer Projection Updater Service
 *
 * Syncs customer projection state from an ingested order:
 *  - backfills `firstName` / `lastName` on the customer projection from
 *    `order.shippingAddress` (fallback `order.billingAddress`), without
 *    clobbering already-set names with `null`;
 *  - upserts shipping + billing address projections.
 *
 * Honours `OL_STORE_PII`: hash-only mode forces names + address fields to
 * `null` (matches `CustomerProjectionService.upsertProjection`).
 *
 * @module libs/core/src/customers/application/services
 * @implements {IOrderCustomerProjectionUpdaterService}
 */
import { Injectable, Inject } from '@nestjs/common';
import type { Order } from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { getPiiConfig, hashAddress, normalizeAddress } from '@openlinker/shared/config';
import {
  ICustomerProjectionService,
  CUSTOMER_PROJECTION_SERVICE_TOKEN,
} from '../interfaces/customer-projection.service.interface';
import { IOrderCustomerProjectionUpdaterService } from '../interfaces/order-customer-projection-updater.service.interface';
import { CustomerProjection } from '../../domain/entities/customer-projection.entity';
import { CustomerAddressProjection } from '../../domain/entities/customer-address-projection.entity';
import { CustomerProjectionException } from '../../domain/exceptions/customer-projection.exception';

/**
 * Returns a trimmed string, or `null` for `undefined` / `null` / empty / whitespace-only input.
 *
 * Allegro occasionally ships `""` for first/last name fields on guest orders;
 * we never want to write those into the projection as a non-null value.
 */
function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

@Injectable()
export class OrderCustomerProjectionUpdaterService
  implements IOrderCustomerProjectionUpdaterService
{
  private readonly logger = new Logger(OrderCustomerProjectionUpdaterService.name);

  constructor(
    @Inject(CUSTOMER_PROJECTION_SERVICE_TOKEN)
    private readonly customerProjectionService: ICustomerProjectionService,
  ) {}

  async updateProjectionsForOrder(
    order: Order,
    internalCustomerId: string,
    sourceConnectionId: string,
  ): Promise<void> {
    if (!internalCustomerId || internalCustomerId.trim() === '') {
      throw new CustomerProjectionException(
        'Internal customer ID is required for projection updates',
        internalCustomerId,
        'internalCustomerId',
      );
    }

    // Two independent steps. Each owns its own short-circuiting; one failing or
    // bailing must NOT prevent the other from running.
    await this.backfillCustomerNames(order, internalCustomerId, sourceConnectionId);
    await this.upsertAddresses(order, internalCustomerId);
  }

  /**
   * Backfill firstName / lastName onto the customer projection from the order's
   * shipping (fallback billing) address.
   *
   * Non-clobbering merge: incoming `null` never overwrites an existing name —
   * `incoming ?? existing`. PII-off mode (`OL_STORE_PII=false`) forces both
   * fields to `null`, intentionally clobbering any previously-stored values
   * (matches `CustomerProjectionService.upsertProjection`'s hash-only behaviour).
   *
   * Skips the round-trip when names + lastSourceConnectionId are unchanged.
   * `lastSeenAt` staleness is handled by `CustomerIdentityResolverService`,
   * which writes the projection earlier in the ingestion pipeline on every order.
   */
  private async backfillCustomerNames(
    order: Order,
    internalCustomerId: string,
    sourceConnectionId: string,
  ): Promise<void> {
    const incomingFirst =
      trimToNull(order.shippingAddress?.firstName) ?? trimToNull(order.billingAddress?.firstName);
    const incomingLast =
      trimToNull(order.shippingAddress?.lastName) ?? trimToNull(order.billingAddress?.lastName);

    const existing = await this.customerProjectionService.getProjection(internalCustomerId);
    if (!existing) {
      this.logger.warn(
        `No customer projection found for ${internalCustomerId} (connection: ${sourceConnectionId}); skipping name backfill`,
      );
      return;
    }

    const piiOn = getPiiConfig().storePii;
    const mergedFirstName = piiOn ? incomingFirst ?? existing.firstName : null;
    const mergedLastName = piiOn ? incomingLast ?? existing.lastName : null;

    const sameNames =
      mergedFirstName === existing.firstName && mergedLastName === existing.lastName;
    const sameConn = sourceConnectionId === existing.lastSourceConnectionId;
    if (sameNames && sameConn) return;

    const now = new Date();
    await this.customerProjectionService.upsertProjection(
      new CustomerProjection(
        existing.internalCustomerId,
        existing.emailHash,
        existing.normalizedEmail,
        mergedFirstName,
        mergedLastName,
        now,
        sourceConnectionId,
        existing.createdAt,
        now,
      ),
    );
  }

  /**
   * Upsert shipping + billing address projections.
   *
   * Billing is skipped when its hash matches shipping's (the common case —
   * buyers typically reuse the same address for both). Hashing is done on the
   * normalized address regardless of PII mode; PII fields are only written when
   * `OL_STORE_PII=true`.
   */
  private async upsertAddresses(order: Order, internalCustomerId: string): Promise<void> {
    const piiConfig = getPiiConfig();
    const now = new Date();

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
        piiConfig.storePii ? normalizedAddress.address2 ?? null : null,
        piiConfig.storePii ? normalizedAddress.city : null,
        piiConfig.storePii ? normalizedAddress.postcode ?? null : null,
        piiConfig.storePii ? normalizedAddress.countryIso2 : null,
        now,
        now,
        now,
      );

      await this.customerProjectionService.upsertAddressProjection(shippingAddressProjection);
    }

    if (order.billingAddress) {
      const normalizedAddress = normalizeAddress({
        address1: order.billingAddress.address1,
        address2: order.billingAddress.address2,
        city: order.billingAddress.city,
        postcode: order.billingAddress.postalCode,
        countryIso2: order.billingAddress.country,
      });

      const addressHash = hashAddress(normalizedAddress);

      if (addressHash !== shippingHash) {
        const billingAddressProjection = new CustomerAddressProjection(
          internalCustomerId,
          addressHash,
          'billing',
          piiConfig.storePii ? normalizedAddress.address1 : null,
          piiConfig.storePii ? normalizedAddress.address2 ?? null : null,
          piiConfig.storePii ? normalizedAddress.city : null,
          piiConfig.storePii ? normalizedAddress.postcode ?? null : null,
          piiConfig.storePii ? normalizedAddress.countryIso2 : null,
          now,
          now,
          now,
        );

        await this.customerProjectionService.upsertAddressProjection(billingAddressProjection);
      }
    }
  }
}
