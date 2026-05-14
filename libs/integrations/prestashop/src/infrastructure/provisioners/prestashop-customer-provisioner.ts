/**
 * PrestaShop Customer Provisioner
 *
 * Provisions guest customers in PrestaShop with concurrency guards to prevent
 * duplicate customer creation. Uses distributed locks (Redis) to handle race
 * conditions when multiple orders arrive simultaneously for the same buyer.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import type { PrestashopConnectionConfig } from '../../domain/types/prestashop-config.types';
import { PrestashopProvisioningException } from '../../domain/exceptions/prestashop-provisioning.exception';
import type { PrestashopCustomer, PrestashopCustomerCreate } from './prestashop-provisioner.types';
import { randomBytes } from 'crypto';

/**
 * Password generation constants
 * PrestaShop requires passwords between 5-72 characters (plain text, PrestaShop hashes internally)
 */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 32;

/**
 * Lock TTL in seconds (30 seconds is sufficient for PrestaShop API calls)
 */
const LOCK_TTL_SECONDS = 30;

/**
 * Generate a random password for PrestaShop guest customer
 *
 * Generates a secure random password between 8-32 characters.
 * PrestaShop accepts 5-72 characters, but we use 8-32 for security.
 *
 * Handles edge case where base64 string may have many special characters
 * after filtering, ensuring password always meets minimum length requirement.
 *
 * @returns Random password string (length between MIN_PASSWORD_LENGTH and MAX_PASSWORD_LENGTH)
 */
function generatePassword(): string {
  // Generate random bytes and convert to base64
  const randomBytesBuffer = randomBytes(24);
  let alphanumeric = randomBytesBuffer.toString('base64').replace(/[^a-zA-Z0-9]/g, '');

  // Determine target length (between MIN and MAX)
  const length =
    MIN_PASSWORD_LENGTH + Math.floor(Math.random() * (MAX_PASSWORD_LENGTH - MIN_PASSWORD_LENGTH));

  // Ensure we have enough characters (base64 may have many special chars after filtering)
  while (alphanumeric.length < length) {
    const additional = randomBytes(8)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '');
    alphanumeric += additional;
  }

  return alphanumeric.substring(0, length);
}

@Injectable()
export class PrestashopCustomerProvisioner {
  private readonly logger = new Logger(PrestashopCustomerProvisioner.name);

  constructor(
    @Inject('REDIS_CLIENT')
    @Optional()
    private readonly redisClient: RedisClientType | null
  ) {}

  /**
   * Get lock key for customer provisioning
   */
  private getLockKey(destinationConnectionId: string, emailHash: string): string {
    return `prestashop:customer-provision:${destinationConnectionId}:${emailHash}`;
  }

  /**
   * Acquire distributed lock for customer provisioning
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
   * Resolve or create guest customer in PrestaShop
   *
   * Handles customer provisioning with concurrency guards:
   * 1. Check existing mapping
   * 2. Acquire distributed lock (if Redis available)
   * 3. Re-check mapping after lock acquisition
   * 4. Query PrestaShop by email (find existing customer)
   * 5. Create guest customer if not found
   * 6. Create mapping with post-create re-check
   * 7. Release lock
   *
   * @param internalCustomerId - Internal customer ID
   * @param normalizedEmail - Normalized email address
   * @param emailHash - Hashed email for lock key
   * @param firstName - Customer first name (optional)
   * @param lastName - Customer last name (optional)
   * @param destinationConnectionId - Destination connection ID
   * @param webserviceClient - PrestaShop WebService client
   * @param connectionConfig - PrestaShop connection configuration
   * @param identifierMapping - Identifier mapping service
   * @returns PrestaShop customer ID
   */
  async resolveOrCreateGuestCustomer(
    internalCustomerId: string,
    normalizedEmail: string,
    emailHash: string,
    firstName: string | null,
    lastName: string | null,
    destinationConnectionId: string,
    webserviceClient: IPrestashopWebserviceClient,
    connectionConfig: PrestashopConnectionConfig,
    identifierMapping: IdentifierMappingPort
  ): Promise<string> {
    // Step 1: Check existing mapping
    this.logger.debug(
      `Internal customer ID: ${internalCustomerId}, destinationConnectionId: ${destinationConnectionId}`
    );
    const externalIds = await identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Customer, internalCustomerId);
    const prestashopMapping = externalIds.find((e) => e.connectionId === destinationConnectionId);

    if (prestashopMapping) {
      this.logger.debug(
        `Customer mapping found: ${internalCustomerId} → ${prestashopMapping.externalId}`
      );
      return String(prestashopMapping.externalId);
    }

    // Step 2: Acquire distributed lock
    const lockKey = this.getLockKey(destinationConnectionId, emailHash);
    const lockAcquired = await this.acquireLock(lockKey);

    if (!lockAcquired) {
      // Another process is provisioning, wait briefly and retry mapping check
      this.logger.debug(`Lock not acquired, waiting for other process to complete`);
      await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 500ms

      // Re-check mapping after waiting
      const retryMapping = await identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Customer, internalCustomerId);
      const retryPrestashopMapping = retryMapping.find(
        (e) => e.connectionId === destinationConnectionId
      );

      if (retryPrestashopMapping) {
        this.logger.debug(
          `Customer mapping found after lock wait: ${internalCustomerId} → ${retryPrestashopMapping.externalId}`
        );
        return String(retryPrestashopMapping.externalId);
      }

      // If still no mapping, throw error
      throw new PrestashopProvisioningException(
        `Failed to acquire lock for customer provisioning: ${internalCustomerId}. ` +
          `Another process may be creating the customer. Please retry.`,
        internalCustomerId,
        destinationConnectionId,
        emailHash,
        normalizedEmail
      );
    }

    try {
      // Step 3: Re-check mapping after lock acquisition
      const postLockMapping = await identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Customer,
        internalCustomerId
      );
      const postLockPrestashopMapping = postLockMapping.find(
        (e) => e.connectionId === destinationConnectionId
      );

      if (postLockPrestashopMapping) {
        this.logger.debug(
          `Customer mapping found after lock acquisition: ${internalCustomerId} → ${postLockPrestashopMapping.externalId}`
        );
        return String(postLockPrestashopMapping.externalId);
      }

      // Step 4: Try to find existing customer in PrestaShop by email
      // NOTE: PrestaShop WebService API may not support email filtering in all versions
      let prestashopCustomerId: string | null = null;

      try {
        const customers = await webserviceClient.listResources<PrestashopCustomer>(
          'customers',
          { custom: { email: normalizedEmail } },
          1, // Only need one match
          0
        );

        const matchingCustomer = customers?.find(
          (c) => c.email?.toLowerCase().trim() === normalizedEmail.toLowerCase().trim()
        );

        if (matchingCustomer) {
          prestashopCustomerId = matchingCustomer.id;
          this.logger.log(
            `Found existing PrestaShop customer by email: ${prestashopCustomerId} (email: ${normalizedEmail})`
          );
        }
      } catch (queryError) {
        // Email query might not be supported - log and continue with creation
        this.logger.debug(
          `Email query failed (may not be supported): ${queryError instanceof Error ? queryError.message : String(queryError)}. Will create customer.`
        );
      }

      // Step 5: Create customer if not found
      if (!prestashopCustomerId) {
        // PS's stock-fixture "Guest" group. Carriers with group restrictions
        // reject any group-0 customer at POST /orders time and silently zero
        // the order's id_carrier (#505). Operators with non-standard group
        // setups can override via connection.config.guestCustomerGroupId.
        const PS_GUEST_GROUP_DEFAULT = 2;
        const configuredGroupId = connectionConfig.guestCustomerGroupId;
        let groupId = PS_GUEST_GROUP_DEFAULT;
        if (configuredGroupId !== undefined) {
          if (Number.isFinite(configuredGroupId) && configuredGroupId > 0) {
            groupId = configuredGroupId;
          } else {
            this.logger.warn(
              `Connection config has invalid guestCustomerGroupId=${String(configuredGroupId)} ` +
                `(must be a positive integer) for connection ${destinationConnectionId} — ` +
                `falling back to PS default Guest group (id=${PS_GUEST_GROUP_DEFAULT}).`
            );
          }
        }

        const customerData: PrestashopCustomerCreate = {
          is_guest: 1,
          passwd: generatePassword(),
          firstname: firstName || 'Guest',
          lastname: lastName || 'Customer',
          email: normalizedEmail,
          active: 1,
          id_default_group: groupId,
          associations: {
            groups: { group: [{ id: groupId }] },
          },
        };

        if (connectionConfig.shopId) {
          customerData.id_shop = connectionConfig.shopId;
        }

        this.logger.debug(`Creating guest customer in PrestaShop with email: ${normalizedEmail}`);

        const createdCustomer = await webserviceClient.createResource<PrestashopCustomer>(
          'customers',
          customerData
        );

        // Extract ID - handle both 'id' property and '@_id' attribute (from XML parsing)
        const customerResponse = createdCustomer as unknown as Record<string, unknown>;
        prestashopCustomerId = String(customerResponse.id || customerResponse['@_id'] || '');

        if (!prestashopCustomerId) {
          throw new PrestashopProvisioningException(
            `Failed to extract customer ID from PrestaShop response. Response: ${JSON.stringify(createdCustomer)}`,
            destinationConnectionId
          );
        }

        this.logger.log(
          `Created guest customer in PrestaShop: ${prestashopCustomerId} (email: ${normalizedEmail})`
        );
      }

      // Step 6: Create mapping with post-create re-check
      try {
        const externalId = await identifierMapping.getOrCreateExactMapping(
          CORE_ENTITY_TYPE.Customer,
          prestashopCustomerId,
          internalCustomerId,
          destinationConnectionId
        );
        return externalId;
      } catch (error) {
        // Mapping may already exist (concurrent request), fetch it
        const duplicateMapping = await identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.Customer,
          internalCustomerId
        );
        const duplicatePrestashopMapping = duplicateMapping.find(
          (e) => e.connectionId === destinationConnectionId
        );

        if (duplicatePrestashopMapping) {
          this.logger.debug(
            `Mapping already exists (concurrent request): ${internalCustomerId} → ${duplicatePrestashopMapping.externalId}`
          );
          return String(duplicatePrestashopMapping.externalId);
        }

        // Re-throw if it's not a duplicate mapping error
        throw error;
      }
    } catch (error) {
      // Re-throw domain exceptions as-is
      if (error instanceof PrestashopProvisioningException) {
        throw error;
      }

      // Wrap other errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PrestashopProvisioningException(
        `Failed to provision customer in PrestaShop: ${errorMessage}`,
        internalCustomerId,
        destinationConnectionId,
        emailHash,
        normalizedEmail
      );
    } finally {
      // Step 7: Release lock
      await this.releaseLock(lockKey);
    }
  }
}
