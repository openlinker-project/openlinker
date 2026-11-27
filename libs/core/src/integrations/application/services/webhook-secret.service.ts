/**
 * Webhook Secret Service
 *
 * Rotates and persists per-connection webhook secrets in the encrypted
 * credentials store. Plaintext is exposed exactly once (as the rotate result)
 * and never retrievable afterwards.
 *
 * @module libs/core/src/integrations/application/services
 * @implements {IWebhookSecretService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Logger } from '@openlinker/shared';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  WebhookSecretProviderPort,
  webhookSecretRef,
} from '../../domain/ports/webhook-secret-provider.port';
import { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import { CredentialNotFoundException } from '../../domain/exceptions/credential-not-found.exception';
import { CallerSuppliedWebhookSecretNotSupportedException } from '../../domain/exceptions/caller-supplied-webhook-secret-not-supported.exception';
import { AdapterRegistryPort } from '../../domain/ports/adapter-registry.port';
import { resolveAcceptsCallerSuppliedWebhookSecret } from '../../domain/types/adapter.types';
import {
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
} from '../../integrations.tokens';
import type {
  IWebhookSecretService,
  RotateWebhookSecretResult,
} from '../interfaces/webhook-secret.service.interface';

const SECRET_BYTES = 32;

@Injectable()
export class WebhookSecretService implements IWebhookSecretService {
  private readonly logger = new Logger(WebhookSecretService.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly credentialRepository: IntegrationCredentialRepositoryPort,
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly secretProvider: WebhookSecretProviderPort,
    @Inject(ADAPTER_REGISTRY_TOKEN)
    private readonly adapterRegistry: AdapterRegistryPort
  ) {}

  async rotate(
    provider: string,
    connectionId: string,
    actorUserId?: string
  ): Promise<RotateWebhookSecretResult> {
    const connection = await this.connectionPort.get(connectionId);
    const secret = randomBytes(SECRET_BYTES).toString('hex');

    await this.persist(connection.platformType, connectionId, secret);
    this.secretProvider.invalidate(provider, connectionId);

    this.logger.log('webhook_secret.rotated', {
      connectionId,
      provider,
      actor: actorUserId ?? 'system',
    });

    return { secret };
  }

  async set(
    provider: string,
    connectionId: string,
    secret: string,
    actorUserId?: string
  ): Promise<void> {
    const connection = await this.connectionPort.get(connectionId);

    // Guard (#1770 review): `set` accepts an arbitrary caller-supplied value,
    // so it's only safe for an adapter that declares its secret is minted
    // externally (`acceptsCallerSuppliedWebhookSecret`, #3981). Any other
    // connection's secret is server-rotated only - accepting a pasted value
    // here would silently desync it from what that platform actually signs with.
    if (!(await this.acceptsCallerSuppliedSecret(connection))) {
      throw new CallerSuppliedWebhookSecretNotSupportedException(connection.platformType);
    }

    await this.persist(connection.platformType, connectionId, secret);
    this.secretProvider.invalidate(provider, connectionId);

    this.logger.log('webhook_secret.set', {
      connectionId,
      provider,
      actor: actorUserId ?? 'system',
    });
  }

  /**
   * The adapter's own declaration; an adapter that cannot be resolved (not
   * registered on this host) accepts nothing, the safe answer for a write guard.
   */
  private async acceptsCallerSuppliedSecret(connection: Connection): Promise<boolean> {
    try {
      const adapterKey =
        connection.adapterKey ?? (await this.adapterRegistry.getDefaultAdapterKey(connection.platformType));
      return resolveAcceptsCallerSuppliedWebhookSecret(
        await this.adapterRegistry.getAdapterMetadata(adapterKey)
      );
    } catch (error) {
      this.logger.warn(
        `Adapter metadata for connection ${connection.id} could not be resolved; refusing a caller-supplied ` +
          `webhook secret: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Upsert the plaintext secret into the encrypted credentials store
   * (the repository encrypts on write, #709). Shared by `rotate` (generated)
   * and `set` (caller-supplied).
   */
  private async persist(
    platformType: string,
    connectionId: string,
    secret: string
  ): Promise<void> {
    const ref = webhookSecretRef(connectionId);
    try {
      await this.credentialRepository.update(ref, {
        credentialsJson: { webhookSecret: secret },
      });
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        await this.credentialRepository.create({
          ref,
          platformType,
          credentialsJson: { webhookSecret: secret },
        });
      } else {
        throw error;
      }
    }
  }
}
