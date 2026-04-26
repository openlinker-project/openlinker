/**
 * AI Provider Settings Service
 *
 * Write-side counterpart to `AiProviderCredentialsPort` (read side). Persists
 * the AI provider API key to the encrypted `integration_credentials` table at
 * `ref = ai-provider:{provider}` and invalidates the port's cache after every
 * write so subsequent completion requests see the new value.
 *
 * Mirrors the shape of `WebhookSecretService` (`libs/core/src/integrations/`)
 * — both wrap the same credential repo + crypto pair.
 *
 * @module libs/core/src/ai/application/services
 * @implements {IAiProviderSettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger, CryptoService } from '@openlinker/shared';
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
import {
  AiProvider,
  AiProviderValues,
} from '../../domain/types/ai-completion.types';
import { AiProviderSettingsView } from '../../domain/types/ai-provider-credentials.types';
import { AiProviderSettingsNotApplicableError } from '../../domain/exceptions/ai-provider-settings-not-applicable.exception';
import { IAiProviderSettingsService } from './ai-provider-settings.service.interface';

const DEFAULT_PROVIDER: AiProvider = 'anthropic';

/** Providers that require an API key. Anything else rejects set/clear with a 400. */
const PROVIDERS_REQUIRING_KEY: ReadonlySet<AiProvider> = new Set<AiProvider>(['anthropic']);

const isAiProvider = (value: string): value is AiProvider =>
  (AiProviderValues as readonly string[]).includes(value);

@Injectable()
export class AiProviderSettingsService implements IAiProviderSettingsService {
  private readonly logger = new Logger(AiProviderSettingsService.name);

  constructor(
    @Inject(AI_PROVIDER_CREDENTIALS_PORT_TOKEN)
    private readonly credentialsPort: AiProviderCredentialsPort,
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly credentialRepository: IntegrationCredentialRepositoryPort,
    private readonly crypto: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  async get(): Promise<AiProviderSettingsView> {
    return this.credentialsPort.describe();
  }

  async set(apiKey: string, actorUserId?: string): Promise<void> {
    const provider = this.getActiveProvider();
    this.assertProviderRequiresKey(provider);

    const ciphertext = this.crypto.encrypt(apiKey);
    const ref = aiProviderCredentialsRef(provider);

    try {
      await this.credentialRepository.update(ref, {
        credentialsJson: { ciphertext },
        encrypted: true,
      });
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        await this.credentialRepository.create({
          ref,
          platformType: provider,
          credentialsJson: { ciphertext },
          encrypted: true,
        });
      } else {
        throw error;
      }
    }

    this.credentialsPort.invalidate();

    this.logger.log('ai_provider_settings.set', {
      provider,
      actor: actorUserId ?? 'system',
    });
  }

  async clear(actorUserId?: string): Promise<void> {
    const provider = this.getActiveProvider();
    this.assertProviderRequiresKey(provider);

    await this.credentialRepository.delete(aiProviderCredentialsRef(provider));
    this.credentialsPort.invalidate();

    this.logger.log('ai_provider_settings.clear', {
      provider,
      actor: actorUserId ?? 'system',
    });
  }

  private getActiveProvider(): AiProvider {
    const raw = this.configService.get<string>('OL_AI_PROVIDER') ?? DEFAULT_PROVIDER;
    return isAiProvider(raw) ? raw : DEFAULT_PROVIDER;
  }

  private assertProviderRequiresKey(provider: AiProvider): void {
    if (!PROVIDERS_REQUIRING_KEY.has(provider)) {
      throw new AiProviderSettingsNotApplicableError(provider);
    }
  }
}
