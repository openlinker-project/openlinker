/**
 * Connection Credentials Rewriter Registry Service (#1387, ADR-031)
 *
 * Holds `ConnectionCredentialsRewriterPort` implementations keyed by
 * `adapterKey`. Plugins self-register via
 * `host.connectionCredentialsRewriterRegistry.register(...)` at boot (or, for
 * rewriters that need a dependency outside `HostServices`, from a companion
 * NestJS module injecting this service's token directly). Consumed by
 * `ConnectionService.updateCredentials` before merge + shape validation.
 * Sibling of {@link ConnectionCredentialsShapeValidatorRegistryService}.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link ConnectionCredentialsRewriterPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import type { ConnectionCredentialsRewriterPort } from '../../domain/ports/connection-credentials-rewriter.port';

@Injectable()
export class ConnectionCredentialsRewriterRegistryService {
  private readonly rewriters: Map<string, ConnectionCredentialsRewriterPort> = new Map();

  register(adapterKey: string, rewriter: ConnectionCredentialsRewriterPort): void {
    this.rewriters.set(adapterKey, rewriter);
  }

  get(adapterKey: string): ConnectionCredentialsRewriterPort | undefined {
    return this.rewriters.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.rewriters.has(adapterKey);
  }
}
