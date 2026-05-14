/**
 * AI Provider Key Service
 *
 * Per-provider API-key writes (encrypted at rest) + reads (status only —
 * never the key value). Each call invalidates the credentials port's cache
 * for that provider so the next completion picks up the new key without
 * waiting for the 60 s TTL.
 *
 * Replaces the old `AiProviderSettingsService` whose contract was implicitly
 * scoped to the active provider; this service is provider-agnostic and is
 * paired with `AiProviderActiveSettingsService` for selection concerns.
 *
 * @module libs/core/src/ai/application/services
 * @implements {IAiProviderKeyService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared';
import {
  IntegrationCredentialRepositoryPort,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  CredentialNotFoundException,
} from '@openlinker/core/integrations';
import { AI_PROVIDER_CREDENTIALS_PORT_TOKEN } from '../../ai.tokens';
import {
  AiProviderCredentialsPort,
  aiProviderCredentialsRef,
} from '../../domain/ports/ai-provider-credentials.port';
import type { AiProvider } from '../../domain/types/ai-completion.types';
import {
  providerRequiresKey,
  type AiProviderSettingsView,
} from '../../domain/types/ai-provider-credentials.types';
import { AiProviderSettingsNotApplicableError } from '../../domain/exceptions/ai-provider-settings-not-applicable.exception';
import type { IAiProviderKeyService } from './ai-provider-key.service.interface';

@Injectable()
export class AiProviderKeyService implements IAiProviderKeyService {
  private readonly logger = new Logger(AiProviderKeyService.name);

  constructor(
    @Inject(AI_PROVIDER_CREDENTIALS_PORT_TOKEN)
    private readonly credentialsPort: AiProviderCredentialsPort,
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly credentialRepository: IntegrationCredentialRepositoryPort,
  ) {}

  describe(provider: AiProvider): Promise<AiProviderSettingsView> {
    return this.credentialsPort.describe(provider);
  }

  describeAll(): Promise<AiProviderSettingsView[]> {
    return this.credentialsPort.describeAll();
  }

  async setKey(provider: AiProvider, apiKey: string, actorUserId?: string): Promise<void> {
    this.assertProviderRequiresKey(provider);

    const ref = aiProviderCredentialsRef(provider);

    // Plaintext at this layer — the repository encrypts on write (#709).
    try {
      await this.credentialRepository.update(ref, {
        credentialsJson: { apiKey },
      });
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        await this.credentialRepository.create({
          ref,
          platformType: provider,
          credentialsJson: { apiKey },
        });
      } else {
        throw error;
      }
    }

    this.credentialsPort.invalidate(provider);

    this.logger.log('ai_provider.set_key', {
      provider,
      actor: actorUserId ?? 'system',
    });
  }

  async clearKey(provider: AiProvider, actorUserId?: string): Promise<void> {
    this.assertProviderRequiresKey(provider);

    await this.credentialRepository.delete(aiProviderCredentialsRef(provider));
    this.credentialsPort.invalidate(provider);

    this.logger.log('ai_provider.clear_key', {
      provider,
      actor: actorUserId ?? 'system',
    });
  }

  private assertProviderRequiresKey(provider: AiProvider): void {
    if (!providerRequiresKey(provider)) {
      throw new AiProviderSettingsNotApplicableError(provider);
    }
  }
}
