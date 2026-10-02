/**
 * Shoper Customer Provisioner
 *
 * Resolve-or-create the Shoper user an order must reference. Shoper rejects
 * `user_id = 0` and does not provision a guest (SPIKE-3638), so there is no
 * guest fallback here: no usable email means no user and the order cannot be
 * placed (`ShoperCustomerUnresolvableException`, terminal).
 *
 * Resolution order, mirroring the WooCommerce provisioner:
 *   1. existing `Customer` identifier mapping on this connection (fast path);
 *   2. lock per (connection, email hash), then re-check the mapping;
 *   3. `POST /users`; on Shoper's duplicate-email 400 look the existing user up
 *      by `filters[email]` and use it;
 *   4. record the mapping, converging on the winner under a concurrent duplicate.
 *
 * Everything else a failed call can mean - auth, a 5xx, a network error - is
 * rethrown untouched, where WooCommerce degrades to a guest order: here a
 * degraded answer would be a wrong user, which is worse than a retry.
 *
 * @module libs/integrations/shoper/src/infrastructure/provisioners
 */
import { Inject, Injectable } from '@nestjs/common';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE, DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';
import { ShoperCustomerUnresolvableException } from '../../domain/exceptions/shoper-customer-unresolvable.exception';
import type { ShoperUser, ShoperUserCreateRequest } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { acquireLockWithWait, lockKeyToken } from './shoper-provisioner.helpers';

export interface ResolveShoperCustomerInput {
  /** Internal OL customer id. */
  readonly internalCustomerId: string | undefined;
  /** Validated buyer email. */
  readonly buyerEmail: string | undefined;
  readonly firstName: string;
  readonly lastName: string;
  readonly connectionId: string;
  readonly client: ShoperHttpClient;
  readonly identifierMapping: IdentifierMappingPort;
}

const DUPLICATE_EMAIL_STATUS = 400;

@Injectable()
export class ShoperCustomerProvisioner {
  private readonly logger = new Logger(ShoperCustomerProvisioner.name);

  constructor(
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
  ) {}

  /** The Shoper `user_id` for this buyer. */
  async resolveOrCreateCustomer(input: ResolveShoperCustomerInput): Promise<string> {
    const { internalCustomerId, buyerEmail, connectionId, identifierMapping } = input;

    if (!internalCustomerId) {
      throw new ShoperCustomerUnresolvableException(connectionId, 'the order has no customer');
    }

    const mapped = await this.findMappedUserId(internalCustomerId, connectionId, identifierMapping);
    if (mapped !== null) {
      return mapped;
    }

    if (!buyerEmail) {
      throw new ShoperCustomerUnresolvableException(
        connectionId,
        'no buyer email on the order (a source without one, or OL_STORE_PII=false)',
      );
    }

    const key = `shoper:customer-provision:${connectionId}:${lockKeyToken(buyerEmail.trim().toLowerCase())}`;
    const token = await acquireLockWithWait(this.syncLock, key);
    if (!token) {
      // Unserialized is safe: Shoper enforces email uniqueness, and the
      // duplicate-email recovery below makes racing writers converge.
      this.logger.warn(
        `Could not acquire the provisioning lock for customer ${internalCustomerId} within budget - ` +
          'proceeding unserialized (Shoper email uniqueness keeps this safe)',
      );
    }

    try {
      const postLock = await this.findMappedUserId(internalCustomerId, connectionId, identifierMapping);
      if (postLock !== null) {
        return postLock;
      }
      const userId = await this.createOrRecover(input, buyerEmail);
      return await this.recordMapping(internalCustomerId, userId, connectionId, identifierMapping);
    } finally {
      if (token) {
        await this.syncLock.release(key, token);
      }
    }
  }

  private async findMappedUserId(
    internalCustomerId: string,
    connectionId: string,
    identifierMapping: IdentifierMappingPort,
  ): Promise<string | null> {
    const mappings = await identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.Customer,
      internalCustomerId,
    );
    return mappings.find((m) => m.connectionId === connectionId)?.externalId ?? null;
  }

  private async createOrRecover(
    input: ResolveShoperCustomerInput,
    buyerEmail: string,
  ): Promise<string> {
    const body: ShoperUserCreateRequest = {
      email: buyerEmail,
      firstname: input.firstName,
      lastname: input.lastName,
      active: 1,
    };
    try {
      const created = await input.client.post<unknown>('/users', body);
      const id = readCreatedId(created.data);
      if (id === null) {
        throw new ShoperCustomerUnresolvableException(
          input.connectionId,
          'Shoper accepted POST /users but returned no user id',
        );
      }
      return id;
    } catch (error) {
      if (error instanceof ShoperApiError && error.statusCode === DUPLICATE_EMAIL_STATUS) {
        const existing = await this.findByEmail(input.client, buyerEmail);
        if (existing !== null) {
          return existing;
        }
      }
      throw error;
    }
  }

  private async findByEmail(client: ShoperHttpClient, email: string): Promise<string | null> {
    const result = await client.get<{ list?: readonly ShoperUser[] }>('/users', {
      'filters[email]': email,
    });
    const wanted = email.trim().toLowerCase();
    const match = (result.data.list ?? []).find((u) => u.email.trim().toLowerCase() === wanted);
    return match === undefined ? null : String(match.user_id);
  }

  private async recordMapping(
    internalCustomerId: string,
    userId: string,
    connectionId: string,
    identifierMapping: IdentifierMappingPort,
  ): Promise<string> {
    try {
      await identifierMapping.createMapping(
        CORE_ENTITY_TYPE.Customer,
        userId,
        connectionId,
        internalCustomerId,
      );
    } catch (error) {
      if (error instanceof DuplicateIdentifierMappingError) {
        const winner = await this.findMappedUserId(internalCustomerId, connectionId, identifierMapping);
        if (winner !== null) {
          return winner;
        }
      }
      throw error;
    }
    return userId;
  }
}

/** Shoper answers a create with the bare id (number or numeric string) or an object carrying it. */
function readCreatedId(data: unknown): string | null {
  if (typeof data === 'number' || (typeof data === 'string' && data.trim() !== '')) {
    return String(data);
  }
  if (typeof data === 'object' && data !== null && 'user_id' in data) {
    const id = (data as { user_id: unknown }).user_id;
    return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
  }
  return null;
}
