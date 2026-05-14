/**
 * Connection Config Shape Validator Registry Service (#587)
 *
 * Holds `ConnectionConfigShapeValidatorPort` implementations keyed by
 * `adapterKey`. Plugin packages call `register(adapterKey, validator)` from
 * their `AdapterPlugin.register(host)` at boot — mirrors
 * `ConnectionTesterRegistryService` / `WebhookProvisioningRegistryService`.
 *
 * Consumed by `ConnectionService` on connection create / update — looks up
 * the validator by the resolved `adapterKey` and calls `.validate(config)`
 * before persistence. Absence of a validator is a deliberate skip (plugins
 * with no config shape to enforce don't register one).
 *
 * @module libs/core/src/integrations/infrastructure/adapters
 * @see {@link ConnectionConfigShapeValidatorPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import type { ConnectionConfigShapeValidatorPort } from '../../domain/ports/connection-config-shape-validator.port';

@Injectable()
export class ConnectionConfigShapeValidatorRegistryService {
  private readonly validators: Map<string, ConnectionConfigShapeValidatorPort> = new Map();

  register(adapterKey: string, validator: ConnectionConfigShapeValidatorPort): void {
    this.validators.set(adapterKey, validator);
  }

  get(adapterKey: string): ConnectionConfigShapeValidatorPort | undefined {
    return this.validators.get(adapterKey);
  }

  has(adapterKey: string): boolean {
    return this.validators.has(adapterKey);
  }
}
