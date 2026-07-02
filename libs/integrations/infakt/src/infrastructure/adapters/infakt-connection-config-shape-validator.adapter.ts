/**
 * Infakt Connection Config Shape Validator
 *
 * Validates the non-secret config for an Infakt connection: an optional
 * `baseUrl` override (sandbox vs production) that, when present, must be a
 * non-empty, well-formed URL; and an optional `defaultPaymentMethod` (#1303)
 * that, when present, must be one of `InfaktPaymentMethodValues`. Registered
 * against `ConnectionConfigShapeValidatorRegistryService` at
 * `infakt.accounting.v1`; `ConnectionService` maps the thrown exception to a
 * 400 at the API boundary.
 *
 * Hand-rolled (no class-validator) — two optional fields don't justify a DTO
 * graph, and the plugin stays dependency-light. Error messages use neutral
 * terminology only.
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters
 * @see {@link ConnectionConfigShapeValidatorPort}
 */
import {
  type ConnectionConfigShapeValidatorPort,
  type FlatValidationIssue,
  InvalidConnectionConfigException,
} from '@openlinker/core/integrations';
import { InfaktPaymentMethodValues } from '../../domain/types/infakt-connection.types';

export class InfaktConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'Infakt') {}

  validate(config: Record<string, unknown>): Promise<void> {
    const issues: FlatValidationIssue[] = [];
    const baseUrl = config.baseUrl;
    const defaultPaymentMethod = config.defaultPaymentMethod;

    if (baseUrl !== undefined && baseUrl !== null) {
      if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
        issues.push({ path: 'baseUrl', message: 'must be a non-empty string' });
      } else if (!this.isValidUrl(baseUrl)) {
        issues.push({ path: 'baseUrl', message: 'must be a valid URL' });
      }
    }

    if (
      defaultPaymentMethod !== undefined &&
      defaultPaymentMethod !== null &&
      !InfaktPaymentMethodValues.includes(
        defaultPaymentMethod as (typeof InfaktPaymentMethodValues)[number],
      )
    ) {
      issues.push({
        path: 'defaultPaymentMethod',
        message: `must be one of: ${InfaktPaymentMethodValues.join(', ')}`,
      });
    }

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }

  private isValidUrl(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
}
