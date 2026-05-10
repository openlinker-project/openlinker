/**
 * Customer Identity Resolver Service
 *
 * Implements customer identity resolution with email fallback mode and collision handling.
 * Resolves internal customer ID from external buyer data, supporting both external-only
 * and email-fallback modes. Handles collisions (multiple customers with same emailHash)
 * by creating new customer and logging warning.
 *
 * @module libs/core/src/customers/application/services
 * @implements {ICustomerIdentityResolverService}
 * @see {@link IdentifierMappingPort} for identifier mapping
 * @see {@link CustomerProjectionRepositoryPort} for projection lookup
 */
import { Injectable, Inject, Logger } from '@nestjs/common';
import { ICustomerIdentityResolverService } from '../interfaces/customer-identity-resolver.service.interface';
import {
  CustomerIdentityResolutionRequest,
  CustomerIdentityResolutionResult,
  CustomerIdentityMode,
} from '../../domain/types/customer-identity.types';
import {
  IdentifierMappingPort,
  ConnectionPort,
  CONNECTION_PORT_TOKEN,
} from '@openlinker/core/identifier-mapping';
import {
  EmailNormalizerPort,
  EmailNormalizerRegistryService,
  EMAIL_NORMALIZER_REGISTRY_TOKEN,
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import { CustomerProjectionRepositoryPort } from '../../domain/ports/customer-projection-repository.port';
import { hashEmail, getEnv, getPiiConfig } from '@openlinker/shared/config';
import { CUSTOMER_PROJECTION_REPOSITORY_TOKEN, CUSTOMER_PROJECTION_SERVICE_TOKEN } from '../../customers.tokens';
import { IDENTIFIER_MAPPING_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import { ICustomerProjectionService } from '../interfaces/customer-projection.service.interface';
import { CustomerProjection } from '../../domain/entities/customer-projection.entity';

@Injectable()
export class CustomerIdentityResolverService implements ICustomerIdentityResolverService {
  private readonly logger = new Logger(CustomerIdentityResolverService.name);
  private readonly identityMode: CustomerIdentityMode;

  constructor(
    @Inject(IDENTIFIER_MAPPING_PORT_TOKEN)
    private readonly identifierMapping: IdentifierMappingPort,
    @Inject(CUSTOMER_PROJECTION_REPOSITORY_TOKEN)
    private readonly projectionRepository: CustomerProjectionRepositoryPort,
    @Inject(CUSTOMER_PROJECTION_SERVICE_TOKEN)
    private readonly customerProjectionService: ICustomerProjectionService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(EMAIL_NORMALIZER_REGISTRY_TOKEN)
    private readonly emailNormalizerRegistry: EmailNormalizerRegistryService,
  ) {
    // Read identity mode from environment (default: email_fallback)
    const modeValue = getEnv('OL_CUSTOMER_IDENTITY_MODE', 'email_fallback');
    if (
      modeValue !== 'external_only' &&
      modeValue !== 'email_fallback' &&
      modeValue !== 'true' &&
      modeValue !== 'false'
    ) {
      this.logger.warn(
        `Invalid OL_CUSTOMER_IDENTITY_MODE value: ${modeValue}. Using default: email_fallback`,
      );
      this.identityMode = 'email_fallback';
    } else {
      // Support legacy boolean values for backward compatibility
      if (modeValue === 'true' || modeValue === 'email_fallback') {
        this.identityMode = 'email_fallback';
      } else {
        this.identityMode = 'external_only';
      }
    }

    if (this.identityMode === 'email_fallback') {
      this.logger.warn(
        'Customer identity mode is set to email_fallback. ' +
          'This may merge customers with shared emails (families, businesses). ' +
          'Set OL_CUSTOMER_IDENTITY_MODE=external_only to use external_only mode.',
      );
    }
  }

  async resolveCustomerIdentity(
    request: CustomerIdentityResolutionRequest,
  ): Promise<CustomerIdentityResolutionResult> {
    const { externalBuyerId, email, sourceConnectionId } = request;

    // Resolve the per-platform email normalizer once up-front and thread
    // it through the rest of the call — keeps the hot order-ingestion
    // path to a single `connectionPort.get` + `resolveAdapterMetadata`
    // round-trip even when both the primary external-mapping branch and
    // the email-fallback branch ultimately upsert a projection.
    // Skip the lookup entirely when `email` is empty (the normalizer is
    // unused on that path).
    const normalizer = email
      ? await this.resolveEmailNormalizer(sourceConnectionId)
      : null;

    // Primary: Try external buyer ID mapping
    const existingMapping = await this.identifierMapping.getInternalId(
      'Customer',
      externalBuyerId,
      sourceConnectionId,
    );

    if (existingMapping) {
      this.logger.debug(
        `Resolved customer identity via external mapping: ${externalBuyerId} → ${existingMapping}`,
      );

      // Update customer projection with email if available
      if (email && normalizer) {
        await this.upsertCustomerProjection(existingMapping, email, sourceConnectionId, normalizer);
      }

      return {
        internalCustomerId: existingMapping,
        usedEmailFallback: false,
        collisionDetected: false,
      };
    }

    // Fallback: Email hash lookup (if enabled)
    if (this.identityMode === 'email_fallback') {
      return this.resolveViaEmailFallback(
        externalBuyerId,
        email,
        sourceConnectionId,
        // Email is always meaningful in the fallback path; ensure the
        // baseline normalizer is used when caller passed an empty string.
        normalizer ?? (await this.resolveEmailNormalizer(sourceConnectionId)),
      );
    }

    // External-only mode: Create new internal customer
    const newInternalId = await this.identifierMapping.getOrCreateInternalId(
      'Customer',
      externalBuyerId,
      sourceConnectionId,
    );

    this.logger.debug(
      `Created new customer identity (external_only mode): ${externalBuyerId} → ${newInternalId}`,
    );

    // Create customer projection with email if available
    if (email && normalizer) {
      await this.upsertCustomerProjection(newInternalId, email, sourceConnectionId, normalizer);
    }

    return {
      internalCustomerId: newInternalId,
      usedEmailFallback: false,
      collisionDetected: false,
    };
  }

  private async resolveViaEmailFallback(
    externalBuyerId: string,
    email: string,
    sourceConnectionId: string,
    normalizer: EmailNormalizerPort,
  ): Promise<CustomerIdentityResolutionResult> {
    // Normalize and hash email — per-platform rules (e.g. Allegro's
    // `+transactionId` masked-email suffix) come from the source
    // connection's registered EmailNormalizerPort, not from a hardcoded
    // platform literal in core (#585 / E5).
    const normalizedEmail = normalizer.normalize(email);
    const emailHash = hashEmail(normalizedEmail);

    // Query projections by emailHash
    const matchingProjections = await this.projectionRepository.findByEmailHash(emailHash);

    if (matchingProjections.length === 0) {
      // No match: Create new internal customer
      const newInternalId = await this.identifierMapping.getOrCreateInternalId(
        'Customer',
        externalBuyerId,
        sourceConnectionId,
      );

      this.logger.debug(
        `Created new customer identity (email fallback, no match): ${externalBuyerId} → ${newInternalId}`,
      );

      // Create customer projection with email
      await this.upsertCustomerProjection(newInternalId, email, sourceConnectionId, normalizer);

      return {
        internalCustomerId: newInternalId,
        usedEmailFallback: true,
        collisionDetected: false,
      };
    }

    if (matchingProjections.length === 1) {
      // Single match: Reuse internal customer ID and create mapping
      const existingInternalId = matchingProjections[0].internalCustomerId;

      try {
        await this.identifierMapping.createMapping(
          'Customer',
          externalBuyerId,
          sourceConnectionId,
          existingInternalId,
        );

        this.logger.debug(
          `Resolved customer identity via email fallback: ${externalBuyerId} → ${existingInternalId}`,
        );

        // Update customer projection with email
        await this.upsertCustomerProjection(existingInternalId, email, sourceConnectionId, normalizer);

        return {
          internalCustomerId: existingInternalId,
          usedEmailFallback: true,
          collisionDetected: false,
        };
      } catch (error) {
        // Mapping may already exist (concurrent request), fetch it
        const mapping = await this.identifierMapping.getInternalId(
          'Customer',
          externalBuyerId,
          sourceConnectionId,
        );

        if (mapping) {
          // Update customer projection with email
          await this.upsertCustomerProjection(mapping, email, sourceConnectionId, normalizer);
          
          return {
            internalCustomerId: mapping,
            usedEmailFallback: true,
            collisionDetected: false,
          };
        }

        // Re-throw if it's not a duplicate mapping error
        throw error;
      }
    }

    // Collision: >1 match on emailHash
    // Create new internal customer and log warning (no merge)
    this.logger.warn(
      `Customer identity collision detected: emailHash ${emailHash} matches ${matchingProjections.length} customers. ` +
        `Creating new internal customer for ${externalBuyerId} to avoid incorrect merge.`,
    );

    const newInternalId = await this.identifierMapping.getOrCreateInternalId(
      'Customer',
      externalBuyerId,
      sourceConnectionId,
    );

    // Create customer projection with email (even in collision case)
    await this.upsertCustomerProjection(newInternalId, email, sourceConnectionId, normalizer);

    return {
      internalCustomerId: newInternalId,
      usedEmailFallback: true,
      collisionDetected: true,
    };
  }

  /**
   * Upsert customer projection with email
   *
   * Creates or updates the customer projection with normalized email and email hash.
   * Handles PII toggle logic via CustomerProjectionService.
   */
  private async upsertCustomerProjection(
    internalCustomerId: string,
    email: string,
    sourceConnectionId: string,
    normalizer: EmailNormalizerPort,
  ): Promise<void> {
    try {
      const normalizedEmail = normalizer.normalize(email);
      const emailHash = hashEmail(normalizedEmail);
      const piiConfig = getPiiConfig();
      const now = new Date();

      const projection = new CustomerProjection(
        internalCustomerId,
        emailHash,
        piiConfig.storePii ? normalizedEmail : null,
        null, // firstName - not available during identity resolution
        null, // lastName - not available during identity resolution
        now, // lastSeenAt
        sourceConnectionId,
        now, // createdAt
        now, // updatedAt
      );

      await this.customerProjectionService.upsertProjection(projection);
    } catch (error) {
      // Log error but don't fail identity resolution if projection update fails
      this.logger.warn(
        `Failed to upsert customer projection for ${internalCustomerId}: ${(error as Error).message}`,
        error,
      );
    }
  }

  /**
   * Look up the `EmailNormalizerPort` registered for the source
   * connection's adapter, falling back to the trim+lowercase baseline
   * when no platform-specific normalizer is registered.
   *
   * Uses `ConnectionPort.get` + `IntegrationsService.resolveAdapterMetadata`
   * — the same canonical dispatch path `ConnectionService.installWebhooks`
   * uses (#583). Unlike `IntegrationsService.getAdapter`, this path does
   * not throw on disabled connections, so customers from a now-disabled
   * connection still resolve correctly.
   */
  private async resolveEmailNormalizer(
    sourceConnectionId: string,
  ): Promise<EmailNormalizerPort> {
    const connection = await this.connectionPort.get(sourceConnectionId);
    const metadata = await this.integrationsService.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: connection.adapterKey,
    });
    return this.emailNormalizerRegistry.resolve(metadata.adapterKey);
  }
}
