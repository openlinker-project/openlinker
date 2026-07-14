/**
 * WooCommerce Customer Provisioner
 *
 * Resolve-or-create a WooCommerce customer for an internal OL customer, with a
 * distributed lock (host `SyncLockPort`, Redis-backed) that serializes
 * concurrent provisioning for the same buyer so simultaneous orders don't
 * create duplicate customers. Mirrors `PrestashopCustomerProvisioner`, adapted
 * to WooCommerce's REST `GET/POST /customers` model.
 *
 * Resolution order:
 *   1. Existing external↔internal mapping (fast path).
 *   2. Acquire lock, re-check mapping.
 *   3. Create WC customer (`POST /customers`); on WC's duplicate-email 400,
 *      look the existing account up by email (`GET /customers?email=`).
 *   4. Record the identifier mapping (with concurrent-duplicate handling).
 *
 * Degrades to guest (customer id `0`) when creation is impossible (no internal
 * customer, no buyer email, corrupted mapping, or a non-auth API error). Auth
 * failures (401/403) are NOT swallowed — they propagate as
 * `WooCommerceAuthFailureException` so the connection can be flagged for
 * re-authentication (#877 I1).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/provisioners
 */
import { Injectable, Inject } from '@nestjs/common';
import type { IdentifierMappingPort, ExternalIdMapping } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE, DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';
import type { IWooCommerceHttpClient } from '../http/woocommerce-http-client.interface';
import { WooCommerceHttpResponseException } from '../http/woocommerce-http-response.exception';
import { WooCommerceUnauthorizedException } from '../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceAuthFailureException } from '../../domain/exceptions/woocommerce-auth-failure.exception';
import type {
  WooCommerceCustomerCreateRequest,
  WooCommerceCustomerResponse,
} from '../adapters/order-processor/woocommerce-order.types';
import { acquireLockWithWait, lockKeyToken } from './woocommerce-provisioner.helpers';

/** The WooCommerce guest sentinel — orders with `customer_id: 0` are guest orders. */
const WC_GUEST_CUSTOMER_ID = 0;

export interface ResolveOrCreateCustomerInput {
  /** Internal OL customer id (undefined for a guest source order). */
  readonly internalCustomerId: string | undefined;
  /** Validated buyer email (undefined when unavailable — forces guest). */
  readonly buyerEmail: string | undefined;
  readonly firstName: string;
  readonly lastName: string;
  readonly connectionId: string;
  readonly httpClient: IWooCommerceHttpClient;
  readonly identifierMapping: IdentifierMappingPort;
}

@Injectable()
export class WooCommerceCustomerProvisioner {
  private readonly logger = new Logger(WooCommerceCustomerProvisioner.name);

  constructor(
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
  ) {}

  private lockKey(connectionId: string, emailHash: string): string {
    return `woocommerce:customer-provision:${connectionId}:${emailHash}`;
  }

  /**
   * Find the WC customer id mapped to this internal customer on this connection.
   * Returns a positive integer id, `0` when the mapping is corrupted (non
   * positive-integer external id), or `null` when there is no mapping.
   */
  private async findMappedCustomerId(
    internalCustomerId: string,
    connectionId: string,
    identifierMapping: IdentifierMappingPort,
  ): Promise<number | null> {
    const externalIds = await identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Customer,
      internalCustomerId,
    );
    const mapping = externalIds.find((e: ExternalIdMapping) => e.connectionId === connectionId);
    if (!mapping) return null;
    const n = Number(mapping.externalId);
    if (!Number.isInteger(n) || n <= 0) {
      this.logger.warn(
        `resolveOrCreateCustomer: corrupted mapping "${mapping.externalId}" for customer ${internalCustomerId} — guest order`,
      );
      return WC_GUEST_CUSTOMER_ID;
    }
    return n;
  }

  async resolveOrCreateCustomer(input: ResolveOrCreateCustomerInput): Promise<number> {
    const {
      internalCustomerId,
      buyerEmail,
      firstName,
      lastName,
      connectionId,
      httpClient,
      identifierMapping,
    } = input;

    if (!internalCustomerId) return WC_GUEST_CUSTOMER_ID;

    // Step 1 — existing mapping (fast path)
    const mapped = await this.findMappedCustomerId(internalCustomerId, connectionId, identifierMapping);
    if (mapped !== null) return mapped;

    // Step 2 — no mapping; provisioning needs an email
    if (!buyerEmail) {
      this.logger.warn(
        `resolveOrCreateCustomer: no WC mapping and no buyerEmail for customer ${internalCustomerId} — guest order`,
      );
      return WC_GUEST_CUSTOMER_ID;
    }

    // Step 3 — serialize provisioning for this buyer under a distributed lock
    const key = this.lockKey(connectionId, lockKeyToken(buyerEmail));
    const token = await acquireLockWithWait(this.syncLock, key);

    try {
      // Step 4 — re-check the mapping now that we hold (or waited for) the lock
      const postLock = await this.findMappedCustomerId(
        internalCustomerId,
        connectionId,
        identifierMapping,
      );
      if (postLock !== null) return postLock;

      // Step 5 — create the WC customer (or recover an existing one by email)
      const wcCustomerId = await this.createOrRecoverCustomer(
        internalCustomerId,
        buyerEmail,
        firstName,
        lastName,
        connectionId,
        httpClient,
      );
      if (wcCustomerId <= 0) return WC_GUEST_CUSTOMER_ID;

      // Step 6 — record the mapping (idempotent under concurrent duplicates)
      return await this.recordMapping(
        internalCustomerId,
        wcCustomerId,
        connectionId,
        identifierMapping,
      );
    } finally {
      if (token) await this.syncLock.release(key, token);
    }
  }

  private async createOrRecoverCustomer(
    internalCustomerId: string,
    buyerEmail: string,
    firstName: string,
    lastName: string,
    connectionId: string,
    httpClient: IWooCommerceHttpClient,
  ): Promise<number> {
    try {
      const created = await httpClient.post<WooCommerceCustomerResponse>(
        '/wp-json/wc/v3/customers',
        {
          email: buyerEmail,
          first_name: firstName,
          last_name: lastName,
        } satisfies WooCommerceCustomerCreateRequest,
      );
      if (!created.id) {
        this.logger.warn(
          `resolveOrCreateCustomer: WC customer POST returned no id for ${internalCustomerId} — guest order`,
        );
        return WC_GUEST_CUSTOMER_ID;
      }
      return created.id;
    } catch (err) {
      // Auth failures must propagate — invalid credentials require re-auth.
      if (err instanceof WooCommerceUnauthorizedException) {
        throw new WooCommerceAuthFailureException(
          `WooCommerce auth failure provisioning customer ${internalCustomerId} on connection ${connectionId}: ${String(err)}`,
          connectionId,
        );
      }
      // WC returns 400 (code 'registration-error-email-exists') for a duplicate
      // email — look the existing account up by email.
      if (err instanceof WooCommerceHttpResponseException && err.statusCode === 400) {
        const existing = await httpClient.get<WooCommerceCustomerResponse[]>(
          '/wp-json/wc/v3/customers',
          { email: buyerEmail },
        );
        const match = existing.find((c) => c.email === buyerEmail);
        if (!match?.id) {
          this.logger.warn(
            `resolveOrCreateCustomer: duplicate email ${buyerEmail} but no matching WC customer — guest order`,
          );
          return WC_GUEST_CUSTOMER_ID;
        }
        return match.id;
      }
      // Non-auth, non-400 (network, rate-limit, server) — degrade to guest.
      this.logger.warn(
        `resolveOrCreateCustomer: WC customer API error for ${internalCustomerId} — guest order: ${String(err)}`,
      );
      return WC_GUEST_CUSTOMER_ID;
    }
  }

  private async recordMapping(
    internalCustomerId: string,
    wcCustomerId: number,
    connectionId: string,
    identifierMapping: IdentifierMappingPort,
  ): Promise<number> {
    try {
      await identifierMapping.createMapping(
        CORE_ENTITY_TYPE.Customer,
        String(wcCustomerId),
        connectionId,
        internalCustomerId,
      );
    } catch (err) {
      if (err instanceof DuplicateIdentifierMappingError) {
        const winner = await this.findMappedCustomerId(
          internalCustomerId,
          connectionId,
          identifierMapping,
        );
        if (winner !== null && winner > 0) return winner;
        this.logger.warn(
          `resolveOrCreateCustomer: concurrent duplicate but no winner for ${internalCustomerId} — guest order`,
        );
        return WC_GUEST_CUSTOMER_ID;
      }
      throw err;
    }
    return wcCustomerId;
  }
}
