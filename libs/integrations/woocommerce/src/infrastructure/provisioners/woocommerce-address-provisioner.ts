/**
 * WooCommerce Address Provisioner
 *
 * WooCommerce has no standalone address resource — billing / shipping addresses
 * live INLINE on the customer (and on each order). This provisioner therefore
 * implements address REUSE, not address creation: it keys off the address hash
 * (`address1`, `address2`, `city`, `postcode`, `countryIso2`) and the
 * `destination_address_mappings` table so a repeat order for the same buyer +
 * address writes the WC customer's inline address at most once. Provisioning
 * for a given (customer, addressHash, type) is serialized with the host
 * `SyncLockPort` (Redis) to prevent duplicate writes under concurrency.
 *
 * Resolution order (mirrors `PrestashopAddressProvisioner`):
 *   1. Primary reuse: `destination_address_mappings` lookup (fast path).
 *   2. Acquire lock, re-check mapping.
 *   3. Recovery: read the WC customer's inline address, match by hash.
 *   4. Otherwise write the address onto the WC customer (`PUT /customers/{id}`).
 *   5. Record the reuse mapping (idempotent under concurrent duplicates).
 *
 * Guest orders (`customer_id: 0`) have no customer account to attach an address
 * to, so provisioning is skipped and returns `null` — the order payload still
 * carries the inline address regardless.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/provisioners
 */
import { Injectable, Inject } from '@nestjs/common';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import type { CustomerProjectionRepositoryPort, AddressType } from '@openlinker/core/customers';
import { DestinationAddressMapping } from '@openlinker/core/customers';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../http/woocommerce-http-client.interface';
import type {
  WooCommerceCustomerWithAddressesResponse,
  WooCommerceCustomerAddressUpdateRequest,
  ResolveOrCreateAddressInput,
} from './woocommerce-provisioner.types';
import {
  acquireLockWithWait,
  computeAddressHash,
  computeWcAddressHash,
  toWcCustomerAddress,
} from './woocommerce-provisioner.helpers';

@Injectable()
export class WooCommerceAddressProvisioner {
  private readonly logger = new Logger(WooCommerceAddressProvisioner.name);

  constructor(
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
  ) {}

  private lockKey(
    connectionId: string,
    wcCustomerId: number,
    addressHash: string,
    addressType: AddressType,
  ): string {
    return `woocommerce:address-provision:${connectionId}:${wcCustomerId}:${addressHash}:${addressType}`;
  }

  /**
   * Resolve (reuse) or write the WC customer's inline address, returning the
   * destination address id recorded for reuse (the WC customer id, as that is
   * where the address lives), or `null` when provisioning is skipped (guest, or
   * a best-effort failure that must not abort order creation).
   */
  async resolveOrCreateAddress(input: ResolveOrCreateAddressInput): Promise<string | null> {
    const {
      internalCustomerId,
      wcCustomerId,
      address,
      addressType,
      connectionId,
      httpClient,
      customerProjectionRepository,
    } = input;

    if (!address || wcCustomerId <= 0) return null;

    const addressHash = computeAddressHash(address);

    // Step 1 — primary reuse: mapping table
    const existing = await customerProjectionRepository.findDestinationAddressMapping(
      internalCustomerId,
      connectionId,
      addressHash,
      addressType,
    );
    if (existing) {
      this.logger.debug(
        `Address reuse hit: ${internalCustomerId} → ${existing.destinationAddressId} (${addressType})`,
      );
      return existing.destinationAddressId;
    }

    // Step 2 — serialize under the distributed lock
    const key = this.lockKey(connectionId, wcCustomerId, addressHash, addressType);
    const token = await acquireLockWithWait(this.syncLock, key);
    if (!token) {
      // The lock could not be acquired within the wait budget (e.g. a Redis
      // outage or heavy contention). Proceeding UNSERIALIZED is safe here —
      // unlike PrestaShop, which throws — because writing the inline address is
      // an idempotent `PUT /customers/{id}` (a racing writer sets the same
      // fields) and the reuse mapping upsert tolerates a concurrent duplicate.
      // We log the degradation so a defeated lock stays observable.
      this.logger.warn(
        `resolveOrCreateAddress: could not acquire provisioning lock for customer ${internalCustomerId} (${addressType}) within budget — proceeding unserialized (idempotent PUT keeps this safe)`,
      );
    }

    try {
      // Step 3 — re-check the mapping under the lock
      const postLock = await customerProjectionRepository.findDestinationAddressMapping(
        internalCustomerId,
        connectionId,
        addressHash,
        addressType,
      );
      if (postLock) {
        this.logger.debug(
          `Address reuse hit after lock: ${internalCustomerId} → ${postLock.destinationAddressId} (${addressType})`,
        );
        return postLock.destinationAddressId;
      }

      // Step 4 — recovery: does the WC customer already carry this address?
      const alreadyPresent = await this.matchesExistingWcAddress(
        wcCustomerId,
        addressType,
        addressHash,
        httpClient,
      );

      // Step 5 — otherwise write the inline address onto the WC customer
      if (!alreadyPresent) {
        const body: WooCommerceCustomerAddressUpdateRequest =
          addressType === 'billing'
            ? { billing: toWcCustomerAddress(address) }
            : { shipping: toWcCustomerAddress(address) };
        await httpClient.put<WooCommerceCustomerWithAddressesResponse>(
          `/wp-json/wc/v3/customers/${wcCustomerId}`,
          body,
        );
        this.logger.debug(
          `Wrote ${addressType} address onto WC customer ${wcCustomerId} (connection: ${connectionId})`,
        );
      }

      // Step 6 — record the reuse mapping (idempotent under concurrent duplicates)
      const destinationAddressId = String(wcCustomerId);
      await this.recordMapping(
        internalCustomerId,
        connectionId,
        addressHash,
        addressType,
        destinationAddressId,
        customerProjectionRepository,
      );
      return destinationAddressId;
    } finally {
      if (token) await this.syncLock.release(key, token);
    }
  }

  private async matchesExistingWcAddress(
    wcCustomerId: number,
    addressType: AddressType,
    addressHash: string,
    httpClient: IWooCommerceHttpClient,
  ): Promise<boolean> {
    try {
      const customer = await httpClient.get<WooCommerceCustomerWithAddressesResponse>(
        `/wp-json/wc/v3/customers/${wcCustomerId}`,
      );
      const wcAddress = addressType === 'billing' ? customer.billing : customer.shipping;
      return computeWcAddressHash(wcAddress) === addressHash;
    } catch (err) {
      // Recovery read is best-effort — if it fails we fall through to a write.
      this.logger.debug(
        `Address recovery read failed for WC customer ${wcCustomerId} — will write: ${String(err)}`,
      );
      return false;
    }
  }

  private async recordMapping(
    internalCustomerId: string,
    connectionId: string,
    addressHash: string,
    addressType: AddressType,
    destinationAddressId: string,
    customerProjectionRepository: CustomerProjectionRepositoryPort,
  ): Promise<void> {
    try {
      const now = new Date();
      await customerProjectionRepository.upsertDestinationAddressMapping(
        new DestinationAddressMapping(
          internalCustomerId,
          connectionId,
          addressHash,
          addressType,
          destinationAddressId,
          now,
          now,
        ),
      );
    } catch (err) {
      // A concurrent writer may have recorded it first — tolerate and move on.
      this.logger.debug(
        `Address mapping upsert raced for ${internalCustomerId} (${addressType}): ${String(err)}`,
      );
    }
  }
}
