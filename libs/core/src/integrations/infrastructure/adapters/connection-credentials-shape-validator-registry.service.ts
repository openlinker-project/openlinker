/**
 * Connection Credentials Shape Validator Registry Service (#586)
 *
 * Holds `ConnectionCredentialsShapeValidatorPort` implementations keyed by
 * `adapterKey`. Plugins self-register via `host.connectionCredentialsShapeValidatorRegistry.register(...)`
 * at boot. Consumed by `ConnectionService` on connection create + credential
 * rotation. Sibling of {@link ConnectionConfigShapeValidatorRegistryService}.
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link ConnectionCredentialsShapeValidatorPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { ConnectionCredentialsShapeValidatorPort } from '../../domain/ports/connection-credentials-shape-validator.port';

@Injectable()
export class ConnectionCredentialsShapeValidatorRegistryService {
  private readonly validators: Map<string, ConnectionCredentialsShapeValidatorPort> = new Map();

  register(adapterKey: string, validator: ConnectionCredentialsShapeValidatorPort): void {
    this.validators.set(adapterKey, validator);
  }

  get(adapterKey: string): ConnectionCredentialsShapeValidatorPort | undefined {
    return this.validators.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.validators.has(adapterKey);
  }
}
