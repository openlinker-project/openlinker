/**
 * OAuth Completion Registry Service
 *
 * Holds `OAuthCompletionPort` implementations keyed by `adapterKey`.
 * Integration modules register their OAuth-completion adapter at bootstrap
 * alongside their connection tester / webhook provisioner / config validator,
 * mirroring `WebhookProvisioningRegistryService` (#583). Consumed by the
 * host's `OAuthConnectionService` to route the per-platform OAuth flow
 * (authorize-URL, code exchange, identity) to the right adapter without the
 * host importing any plugin (#859).
 *
 * Silent overwrite on duplicate `adapterKey` mirrors the sibling registries;
 * integration modules register exactly once at boot so collisions are
 * near-impossible by construction.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link OAuthCompletionPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import type { OAuthCompletionPort } from '../../domain/ports/oauth-completion.port';

@Injectable()
export class OAuthCompletionRegistryService {
  private readonly adapters: Map<string, OAuthCompletionPort> = new Map();

  register(adapterKey: string, adapter: OAuthCompletionPort): void {
    this.adapters.set(adapterKey, adapter);
  }

  get(adapterKey: string): OAuthCompletionPort | undefined {
    return this.adapters.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.adapters.has(adapterKey);
  }
}
