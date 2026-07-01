/**
 * KSeF Connection Config Shape Validator
 *
 * Validates the non-secret config for a KSeF connection: a required `env`
 * selecting the target environment (`test` | `demo` | `prod`), plus an
 * optional `seller.defaultTaxRate` check (must be a known `FA3_TAX_RATE_MAP`
 * key when present, #1291) so a mistyped rate is rejected at connection-save
 * time instead of surfacing as `UnmappedTaxRateException` at issuance. The
 * seller's tax identifier itself (`nip`/`name`/`address`) is intentionally
 * NOT validated here yet — a future pass tightens KSeF connection-shape
 * validation across all seller fields. Registered against
 * `ConnectionConfigShapeValidatorRegistryService` at `ksef.publicapi.v2`;
 * `ConnectionService` maps the thrown exception to a 400 at the API boundary.
 *
 * Hand-rolled (no class-validator) — the field count doesn't justify a DTO
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
import { FA3_TAX_RATE_MAP } from '../fa3/domain/fa3-tax-rate.mapper';

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

    const seller = config.seller;
    if (seller !== undefined && seller !== null && typeof seller === 'object') {
      const defaultTaxRate = (seller as Record<string, unknown>).defaultTaxRate;
      if (defaultTaxRate !== undefined) {
        if (typeof defaultTaxRate !== 'string' || defaultTaxRate.trim().length === 0) {
          issues.push({
            path: 'seller.defaultTaxRate',
            message: 'must be a non-empty string',
          });
        } else if (!(defaultTaxRate in FA3_TAX_RATE_MAP)) {
          issues.push({
            path: 'seller.defaultTaxRate',
            message: `must be one of: ${Object.keys(FA3_TAX_RATE_MAP).join(', ')}`,
          });
        }
      }
    }

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }
}
