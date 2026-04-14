/**
 * Connection Tester Registry
 *
 * Holds ConnectionTesterPort implementations keyed by adapterKey. Integration
 * modules register their testers at bootstrap (mirrors AdapterFactoryResolverService).
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 */
import { Injectable } from '@nestjs/common';
import { ConnectionTesterPort } from '../../domain/ports/connection-tester.port';

@Injectable()
export class ConnectionTesterRegistryService {
  private readonly testers: Map<string, ConnectionTesterPort> = new Map();

  register(adapterKey: string, tester: ConnectionTesterPort): void {
    this.testers.set(adapterKey, tester);
  }

  get(adapterKey: string): ConnectionTesterPort | undefined {
    return this.testers.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.testers.has(adapterKey);
  }
}
