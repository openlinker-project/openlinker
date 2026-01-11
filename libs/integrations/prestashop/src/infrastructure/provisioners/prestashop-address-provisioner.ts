/**
 * PrestaShop Address Provisioner
 *
 * Provisions addresses in PrestaShop with concurrency guards to prevent
 * duplicate address creation. Uses distributed locks (Redis) to handle race
 * conditions when multiple orders arrive simultaneously with the same address.
 *
 * Prioritizes mapping table lookup for fast address reuse, with fallback to
 * PrestaShop API query for recovery scenarios (e.g., after DB reset).
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { RedisClientType } from 'redis';
import { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import { PrestashopCountryResolver } from './prestashop-country-resolver';
import { PrestashopProvisioningException } from '../../domain/exceptions/prestashop-provisioning.exception';
import { PrestashopCountryNotFoundException } from '../../domain/exceptions/prestashop-country-not-found.exception';
import { hashAddress, NormalizedAddress } from '@openlinker/shared/config';
import {
  CustomerProjectionRepositoryPort,
  DestinationAddressMapping,
  AddressType,
} from '@openlinker/core/customers';
import { Address } from '@openlinker/core/orders';
import {
  PrestashopAddress,
  PrestashopAddressCreate,
} from './prestashop-provisioner.types';

/**
 * Lock TTL in seconds (30 seconds is sufficient for PrestaShop API calls)
 */
const LOCK_TTL_SECONDS = 30;

/**
 * Generate deterministic alias for PrestaShop address
 *
 * Creates a deterministic alias based on address type and hash prefix.
 * Format: `OL-{type}-{hashPrefix}` (e.g., `OL-shipping-a1b2c3`)
 *
 * @param addressType - Address type (shipping or billing)
 * @param addressHash - Full address hash
 * @returns Deterministic alias string
 */
function generateAddressAlias(addressType: AddressType, addressHash: string): string {
  // Use first 6 characters of hash for alias (sufficient for uniqueness)
  const hashPrefix = addressHash.substring(0, 6);
  return `OL-${addressType}-${hashPrefix}`;
}

@Injectable()
export class PrestashopAddressProvisioner {
  private readonly logger = new Logger(PrestashopAddressProvisioner.name);

  constructor(
    @Inject('REDIS_CLIENT')
    @Optional()
    private readonly redisClient: RedisClientType | null,
    private readonly countryResolver: PrestashopCountryResolver,
  ) {}

  /**
   * Get lock key for address provisioning
   */
  private getLockKey(
    destinationConnectionId: string,
    prestashopCustomerId: string,
    addressHash: string,
    addressType: AddressType,
  ): string {
    return `prestashop:address-provision:${destinationConnectionId}:${prestashopCustomerId}:${addressHash}:${addressType}`;
  }

  /**
   * Acquire distributed lock for address provisioning
   *
   * @param lockKey - Lock key
   * @returns true if lock acquired, false if already locked
   */
  private async acquireLock(lockKey: string): Promise<boolean> {
    if (!this.redisClient) {
      this.logger.warn('Redis client not available, skipping distributed lock');
      return true; // Allow operation to proceed without lock (graceful degradation)
    }

    try {
      // SET key "locked" NX EX 30
      const result = await this.redisClient.set(lockKey, 'locked', {
        NX: true,
        EX: LOCK_TTL_SECONDS,
      });

      return result === 'OK';
    } catch (error) {
      this.logger.error(`Failed to acquire lock: ${lockKey}`, error);
      // On Redis error, allow operation to proceed (graceful degradation)
      return true;
    }
  }

  /**
   * Release distributed lock
   */
  private async releaseLock(lockKey: string): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    try {
      await this.redisClient.del(lockKey);
    } catch (error) {
      this.logger.error(`Failed to release lock: ${lockKey}`, error);
      // Non-critical error, don't throw
    }
  }

  /**
   * Hash address from order Address object
   *
   * Converts order Address to NormalizedAddress format and computes hash.
   */
  private computeAddressHash(address: Address): string {
    const normalized: NormalizedAddress = {
      address1: address.address1,
      address2: address.address2,
      city: address.city,
      postcode: address.postalCode,
      countryIso2: address.country,
    };

    return hashAddress(normalized);
  }

  /**
   * Resolve or create address in PrestaShop
   *
   * Handles address provisioning with concurrency guards:
   * 1. Compute addressHash from normalized address fields
   * 2. Primary reuse: Query destination_address_mappings table
   * 3. Fallback: Acquire lock, re-check mapping, query PrestaShop, match by hash
   * 4. Create address if not found (resolve country ID)
   * 5. Store mapping with post-create re-check
   * 6. Release lock
   *
   * @param internalCustomerId - Internal customer ID
   * @param prestashopCustomerId - PrestaShop customer ID (external)
   * @param address - Order address data
   * @param addressType - Address type (shipping or billing)
   * @param destinationConnectionId - Destination connection ID
   * @param webserviceClient - PrestaShop WebService client
   * @param connectionConfig - PrestaShop connection configuration
   * @param customerProjectionRepository - Customer projection repository for mapping lookup
   * @returns PrestaShop address ID
   */
  async resolveOrCreateAddress(
    internalCustomerId: string,
    prestashopCustomerId: string,
    address: Address,
    addressType: AddressType,
    destinationConnectionId: string,
    webserviceClient: IPrestashopWebserviceClient,
    _connectionConfig: PrestashopConnectionConfig,
    customerProjectionRepository: CustomerProjectionRepositoryPort,
  ): Promise<string> {
    // Step 1: Compute addressHash
    const addressHash = this.computeAddressHash(address);

    // Step 2: Primary reuse - Query destination_address_mappings table
    const existingMapping = await customerProjectionRepository.findDestinationAddressMapping(
      internalCustomerId,
      destinationConnectionId,
      addressHash,
      addressType,
    );

    if (existingMapping) {
      this.logger.debug(
        `Address mapping found: ${internalCustomerId} → ${existingMapping.destinationAddressId} (${addressType})`,
      );
      return existingMapping.destinationAddressId;
    }

    // Step 3: Fallback - Acquire distributed lock
    const lockKey = this.getLockKey(destinationConnectionId, prestashopCustomerId, addressHash, addressType);
    const lockAcquired = await this.acquireLock(lockKey);

    if (!lockAcquired) {
      // Another process is provisioning, wait briefly and retry mapping check
      this.logger.debug(`Lock not acquired, waiting for other process to complete`);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 500ms

      // Re-check mapping after waiting
      const retryMapping = await customerProjectionRepository.findDestinationAddressMapping(
        internalCustomerId,
        destinationConnectionId,
        addressHash,
        addressType,
      );

      if (retryMapping) {
        this.logger.debug(
          `Address mapping found after lock wait: ${internalCustomerId} → ${retryMapping.destinationAddressId} (${addressType})`,
        );
        return retryMapping.destinationAddressId;
      }

      // If still no mapping, throw error
      throw new PrestashopProvisioningException(
        `Failed to acquire lock for address provisioning: ${internalCustomerId} (${addressType}). ` +
          `Another process may be creating the address. Please retry.`,
        internalCustomerId,
        destinationConnectionId,
        addressHash, // Include addressHash for debugging
      );
    }

    try {
      // Step 4: Re-check mapping after lock acquisition
      const postLockMapping = await customerProjectionRepository.findDestinationAddressMapping(
        internalCustomerId,
        destinationConnectionId,
        addressHash,
        addressType,
      );

      if (postLockMapping) {
        this.logger.debug(
          `Address mapping found after lock acquisition: ${internalCustomerId} → ${postLockMapping.destinationAddressId} (${addressType})`,
        );
        return postLockMapping.destinationAddressId;
      }

      // Step 5: Fallback - Query PrestaShop addresses for the customer
      // Note: PrestashopWebserviceClient must generate filter[id_customer]=[value]&display=[id,address1,city,postcode] format
      // Note: Limit of 100 addresses. If customer has more addresses, matching may fail.
      // This is acceptable for MVP since mapping table is primary reuse mechanism.
      // Future: Implement pagination for customers with many addresses.
      const addresses = await webserviceClient.listResources<PrestashopAddress>(
        'addresses',
        {
          custom: { id_customer: prestashopCustomerId },
        },
        100, // limit (reasonable for address list, but may miss addresses if customer has >100)
        0, // offset
      );

      // Step 6: Match by hash (best effort - compare hashes of fetched addresses)
      /**
       * Address hash matching logic
       *
       * We fetch addresses from PrestaShop and match them by hash. However, PrestaShop
       * returns id_country (numeric ID) while we need countryIso2 (ISO code) for hashing.
       *
       * Current approach: Use the order address's countryIso2 for comparison, assuming
       * that if address1, city, postcode match and the order has the same country, it's
       * the same address. This is a best-effort match.
       *
       * Future optimization: Cache country ID → ISO2 mappings to enable full hash matching
       * with PrestaShop's id_country values.
       */
      let matchingAddress: PrestashopAddress | null = null;

      if (addresses && addresses.length > 0) {
        // Normalize and hash each address from PrestaShop
        for (const prestashopAddr of addresses) {
          if (
            prestashopAddr.address1 &&
            prestashopAddr.city &&
            prestashopAddr.postcode &&
            prestashopAddr.id_country
          ) {
            // We need country ISO2 code to hash, but PrestaShop returns id_country
            // For now, we'll match by address1, city, postcode (best effort)
            // Full hash matching would require reverse lookup of country ID → ISO2
            const normalized: NormalizedAddress = {
              address1: prestashopAddr.address1,
              address2: prestashopAddr.address2,
              city: prestashopAddr.city,
              postcode: prestashopAddr.postcode,
              countryIso2: address.country, // Use order address country for comparison
            };

            const prestashopHash = hashAddress(normalized);
            if (prestashopHash === addressHash) {
              matchingAddress = prestashopAddr;
              break;
            }
          }
        }
      }

      // Step 7: Create address if not found
      let prestashopAddressId: string;

      if (matchingAddress) {
        // Address exists in PrestaShop, use existing ID
        prestashopAddressId = matchingAddress.id;
        this.logger.debug(`Found existing PrestaShop address: ${prestashopAddressId} (${addressType})`);
      } else {
        // Create new address
        // Resolve country ID
        const countryId = await this.countryResolver.resolveCountryId(
          address.country,
          destinationConnectionId,
          webserviceClient,
        );

        // Generate deterministic alias
        const alias = generateAddressAlias(addressType, addressHash);

        // Validate and convert customer ID
        const customerIdNum =
          typeof prestashopCustomerId === 'number'
            ? prestashopCustomerId
            : Number.parseInt(prestashopCustomerId, 10);

        if (Number.isNaN(customerIdNum)) {
          throw new PrestashopProvisioningException(
            `Invalid PrestaShop customer ID: ${prestashopCustomerId}`,
            internalCustomerId,
            destinationConnectionId,
            addressHash,
          );
        }

        const addressData: PrestashopAddressCreate = {
          id_customer: customerIdNum,
          id_country: countryId,
          alias,
          firstname: address.firstName || 'Guest',
          lastname: address.lastName || 'Customer',
          address1: address.address1,
          address2: address.address2,
          city: address.city,
          postcode: address.postalCode,
          phone: address.phone,
        };

        const createdAddress = await webserviceClient.createResource<PrestashopAddress>(
          'addresses',
          addressData,
        );

        prestashopAddressId = createdAddress.id;
        this.logger.log(
          `Created address in PrestaShop: ${prestashopAddressId} (${addressType}, alias: ${alias})`,
        );
      }

      // Step 8: Store mapping with post-create re-check
      try {
        const mapping = new DestinationAddressMapping(
          internalCustomerId,
          destinationConnectionId,
          addressHash,
          addressType,
          prestashopAddressId,
          new Date(),
          new Date(),
        );

        await customerProjectionRepository.upsertDestinationAddressMapping(mapping);
      } catch (error) {
        // Mapping may already exist (concurrent request), fetch it
        const duplicateMapping = await customerProjectionRepository.findDestinationAddressMapping(
          internalCustomerId,
          destinationConnectionId,
          addressHash,
          addressType,
        );

        if (duplicateMapping) {
          this.logger.debug(
            `Mapping already exists (concurrent request): ${internalCustomerId} → ${duplicateMapping.destinationAddressId} (${addressType})`,
          );
          return duplicateMapping.destinationAddressId;
        }

        // Re-throw if it's not a duplicate mapping error
        throw error;
      }

      return prestashopAddressId;
    } catch (error) {
      // Re-throw domain exceptions as-is
      if (error instanceof PrestashopProvisioningException || error instanceof PrestashopCountryNotFoundException) {
        throw error;
      }

      // Wrap other errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PrestashopProvisioningException(
        `Failed to provision address in PrestaShop: ${errorMessage}`,
        internalCustomerId,
        destinationConnectionId,
        addressHash,
      );
    } finally {
      // Step 9: Release lock
      await this.releaseLock(lockKey);
    }
  }
}
