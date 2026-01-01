/**
 * Stub Webhook Secret Provider
 *
 * MVP stub implementation of WebhookSecretProviderPort that reads webhook secrets
 * from environment variables. This is a temporary implementation for MVP;
 * production should use a proper credential management system (e.g., Vault).
 *
 * Environment variable pattern:
 * - `OPENLINKER_WEBHOOK_SECRET__{PROVIDER}__{CONNECTION_ID}` (connection-specific)
 * - `OPENLINKER_WEBHOOK_SECRET__{PROVIDER}` (provider-level fallback)
 *
 * Example:
 * - `OPENLINKER_WEBHOOK_SECRET__prestashop__123e4567-e89b-12d3-a456-426614174000`
 * - `OPENLINKER_WEBHOOK_SECRET__prestashop` (fallback)
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @implements {WebhookSecretProviderPort}
 * @see {@link WebhookSecretProviderPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookSecretProviderPort } from '@openlinker/core/integrations/domain/ports/webhook-secret-provider.port';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class StubWebhookSecretProvider implements WebhookSecretProviderPort {
  private readonly logger = new Logger(StubWebhookSecretProvider.name);

  constructor(private readonly configService: ConfigService) {}

  getSecret(provider: string, connectionId: string): Promise<string> {
    // Try connection-specific secret first
    const connectionSpecificKey = `OPENLINKER_WEBHOOK_SECRET__${provider.toUpperCase()}__${connectionId.toUpperCase()}`;
    const connectionSpecificSecret = this.configService.get<string>(connectionSpecificKey);

    if (connectionSpecificSecret) {
      this.logger.debug(`Found connection-specific webhook secret for ${provider}:${connectionId}`);
      return Promise.resolve(connectionSpecificSecret);
    }

    // Fallback to provider-level secret
    const providerKey = `OPENLINKER_WEBHOOK_SECRET__${provider.toUpperCase()}`;
    const providerSecret = this.configService.get<string>(providerKey);

    if (providerSecret) {
      this.logger.debug(`Using provider-level webhook secret for ${provider}`);
      return Promise.resolve(providerSecret);
    }

    // No secret found
    const errorMessage = `Webhook secret not found for provider: ${provider}, connectionId: ${connectionId}. ` +
      `Checked keys: ${connectionSpecificKey}, ${providerKey}`;
    this.logger.error(errorMessage);
    return Promise.reject(new Error(errorMessage));
  }
}

