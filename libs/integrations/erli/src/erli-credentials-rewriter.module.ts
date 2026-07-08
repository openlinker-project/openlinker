/**
 * Erli Credentials Rewriter Module (#1387, ADR-031)
 *
 * Companion NestJS module composed into `ErliIntegrationModule`. It exists
 * because `ErliAllegroCredentialsRewriterAdapter` needs a NestJS-injected
 * `ConnectionPort` (to resolve the referenced sibling Allegro connection) —
 * deliberately NOT part of the framework-neutral `HostServices` bag. Rather
 * than restructure the whole Erli plugin, this small module injects exactly
 * `ConnectionPort` + `CredentialsResolverPort` + the rewriter registry, and
 * registers the adapter in `onModuleInit`. Mirrors
 * `ErliWebhookProvisioningModule`'s shape.
 *
 * @module libs/integrations/erli/src
 */
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import {
  CredentialsResolverPort,
  CREDENTIALS_RESOLVER_TOKEN,
  IntegrationsModule,
  ConnectionCredentialsRewriterRegistryService,
  CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import {
  ConnectionPort,
  CONNECTION_PORT_TOKEN,
  IdentifierMappingModule,
} from '@openlinker/core/identifier-mapping';
import { ERLI_ADAPTER_KEY } from './erli.constants';
import { ErliAllegroCredentialsRewriterAdapter } from './infrastructure/adapters/erli-allegro-credentials-rewriter.adapter';

@Module({
  imports: [IntegrationsModule, IdentifierMappingModule],
})
export class ErliCredentialsRewriterModule implements OnModuleInit {
  constructor(
    @Inject(CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN)
    private readonly connectionCredentialsRewriterRegistry: ConnectionCredentialsRewriterRegistryService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort
  ) {}

  onModuleInit(): void {
    this.connectionCredentialsRewriterRegistry.register(
      ERLI_ADAPTER_KEY,
      new ErliAllegroCredentialsRewriterAdapter(this.connectionPort, this.credentialsResolver)
    );
  }
}
