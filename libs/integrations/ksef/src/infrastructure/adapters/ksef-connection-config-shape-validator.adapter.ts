/**
 * KSeF Connection Config Shape Validator
 *
 * Validates the non-secret config for a KSeF connection: a required `env`
 * selecting the target environment (`test` | `demo` | `prod`), an optional
 * `seller.defaultTaxRate` check (must be a known `FA3_TAX_RATE_MAP` key when
 * present, #1291) so a mistyped rate is rejected at connection-save time
 * instead of surfacing as `UnmappedTaxRateException` at issuance, and an
 * optional `payment` check (#1311): `formaPlatnosci` must be a valid
 * `TFormaPlatnosci` code, `bankAccount.nrRb` must be non-empty when
 * `bankAccount` is set, `paymentTermDays` must be a non-negative integer. The
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
import { KsefEnvironmentValues, KsefFormaPlatnosciValues } from '../../domain/types/ksef-connection.types';
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
        } else if (!Object.prototype.hasOwnProperty.call(FA3_TAX_RATE_MAP, defaultTaxRate)) {
          issues.push({
            path: 'seller.defaultTaxRate',
            message: `must be one of: ${Object.keys(FA3_TAX_RATE_MAP).join(', ')}`,
          });
        }
      }
    }

    const payment = config.payment;
    if (payment !== undefined && payment !== null && typeof payment === 'object') {
      const p = payment as Record<string, unknown>;
      if (p.formaPlatnosci !== undefined) {
        if (
          typeof p.formaPlatnosci !== 'string' ||
          !(KsefFormaPlatnosciValues as readonly string[]).includes(p.formaPlatnosci)
        ) {
          issues.push({
            path: 'payment.formaPlatnosci',
            message: `must be one of: ${KsefFormaPlatnosciValues.join(', ')}`,
          });
        }
      }
      if (p.bankAccount !== undefined && p.bankAccount !== null && typeof p.bankAccount === 'object') {
        const nrRb = (p.bankAccount as Record<string, unknown>).nrRb;
        if (typeof nrRb !== 'string' || nrRb.trim().length === 0) {
          issues.push({
            path: 'payment.bankAccount.nrRb',
            message: 'must be a non-empty string when bankAccount is set',
          });
        }
      }
      if (
        p.paymentTermDays !== undefined &&
        (typeof p.paymentTermDays !== 'number' ||
          !Number.isInteger(p.paymentTermDays) ||
          p.paymentTermDays < 0)
      ) {
        issues.push({
          path: 'payment.paymentTermDays',
          message: 'must be a non-negative integer',
        });
      }
    }

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }
}
