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
import {
  WebhookSecretProviderPort,
  webhookSecretRef,
} from '../../domain/ports/webhook-secret-provider.port';
import { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import { CredentialNotFoundException } from '../../domain/exceptions/credential-not-found.exception';
import {
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
    private readonly secretProvider: WebhookSecretProviderPort
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

    await this.persist(connection.platformType, connectionId, secret);
    this.secretProvider.invalidate(provider, connectionId);

    this.logger.log('webhook_secret.set', {
      connectionId,
      provider,
      actor: actorUserId ?? 'system',
    });
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
