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
import { Logger, CryptoService } from '@openlinker/shared';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import { WebhookSecretProviderPort, webhookSecretRef } from '../../domain/ports/webhook-secret-provider.port';
import { IntegrationCredentialRepositoryPort } from '../../domain/ports/integration-credential-repository.port';
import { CredentialNotFoundException } from '../../domain/exceptions/credential-not-found.exception';
import {
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
} from '../../integrations.tokens';
import {
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
    private readonly crypto: CryptoService,
    @Inject(WEBHOOK_SECRET_PROVIDER_TOKEN)
    private readonly secretProvider: WebhookSecretProviderPort,
  ) {}

  async rotate(
    provider: string,
    connectionId: string,
    actorUserId?: string,
  ): Promise<RotateWebhookSecretResult> {
    const connection = await this.connectionPort.get(connectionId);

    const secret = randomBytes(SECRET_BYTES).toString('hex');
    const ciphertext = this.crypto.encrypt(secret);
    const ref = webhookSecretRef(connectionId);

    try {
      await this.credentialRepository.update(ref, {
        credentialsJson: { ciphertext },
        encrypted: true,
      });
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        await this.credentialRepository.create({
          ref,
          platformType: connection.platformType,
          credentialsJson: { ciphertext },
          encrypted: true,
        });
      } else {
        throw error;
      }
    }

    this.secretProvider.invalidate(provider, connectionId);

    this.logger.log('webhook_secret.rotated', {
      connectionId,
      provider,
      actor: actorUserId ?? 'system',
    });

    return { secret };
  }
}
