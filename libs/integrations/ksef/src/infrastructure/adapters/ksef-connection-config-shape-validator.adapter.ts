/**
 * KSeF Connection Config Shape Validator
 *
 * Validates the non-secret config for a KSeF connection: a required `env`
 * selecting the target environment (`test` | `demo` | `prod`). The seller's tax
 * identifier is intentionally NOT part of the config — it travels with the
 * issued document, and ADR-026 keeps regime concepts out of the cross-context
 * surface. Registered against `ConnectionConfigShapeValidatorRegistryService`
 * at `ksef.publicapi.v2`; `ConnectionService` maps the thrown exception to a 400
 * at the API boundary.
 *
 * Hand-rolled (no class-validator) — one required field doesn't justify a DTO
 * graph, and the plugin stays dependency-light. Error messages use neutral
 * terminology only (no Polish tax vocabulary).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 * @see {@link ConnectionConfigShapeValidatorPort}
 */
import {
  type ConnectionConfigShapeValidatorPort,
  type FlatValidationIssue,
  InvalidConnectionConfigException,
} from '@openlinker/core/integrations';
import { KsefEnvironmentValues } from '../../domain/types/ksef-connection.types';

export class KsefConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'KSeF') {}

  validate(config: Record<string, unknown>): Promise<void> {
    const issues: FlatValidationIssue[] = [];
    const env = config.env;

    if (typeof env !== 'string' || env.trim().length === 0) {
      issues.push({ path: 'env', message: 'must be a non-empty string' });
    } else if (!(KsefEnvironmentValues as readonly string[]).includes(env)) {
      issues.push({
        path: 'env',
        message: `must be one of: ${KsefEnvironmentValues.join(', ')}`,
      });
    }

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }
}
