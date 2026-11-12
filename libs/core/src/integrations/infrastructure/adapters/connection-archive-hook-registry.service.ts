/**
 * Connection Archive Hook Registry Service (#3974)
 *
 * Holds `ConnectionArchiveHookPort` implementations keyed by `adapterKey`.
 * Plugins register from their NestJS module by injecting
 * `CONNECTION_ARCHIVE_HOOK_REGISTRY_TOKEN`. Consumed by
 * `ConnectionService.archive` after the connection row is archived.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link ConnectionArchiveHookPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import type { ConnectionArchiveHookPort } from '../../domain/ports/connection-archive-hook.port';

@Injectable()
export class ConnectionArchiveHookRegistryService {
  private readonly hooks: Map<string, ConnectionArchiveHookPort> = new Map();

  register(adapterKey: string, hook: ConnectionArchiveHookPort): void {
    this.hooks.set(adapterKey, hook);
  }

  get(adapterKey: string): ConnectionArchiveHookPort | undefined {
    return this.hooks.get(adapterKey);
  }
}
