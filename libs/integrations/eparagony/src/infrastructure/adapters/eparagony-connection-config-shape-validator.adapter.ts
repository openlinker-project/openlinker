/**
 * eparagony.pl Connection Config Shape Validator
 *
 * Validates the non-secret config an operator submits for an eparagony.pl
 * connection (#587). Registered against
 * `ConnectionConfigShapeValidatorRegistryService` at the plugin's adapter key;
 * `ConnectionService` maps the thrown exception to a 400 at the API boundary.
 *
 * Catching a malformed config here matters more than usual for this plugin: a
 * bad `posId` or a nonsense rate table does not fail until a real sale is being
 * registered, and by then the operator is looking at an unregistered order
 * rather than a form error.
 *
 * Hand-rolled (no class-validator), matching the Infakt/KSeF precedent, and
 * never echoing a submitted value back in an error message.
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 * @see {@link ConnectionConfigShapeValidatorPort}
 */
import {
  type ConnectionConfigShapeValidatorPort,
  type FlatValidationIssue,
  InvalidConnectionConfigException,
} from '@openlinker/core/integrations';

import {
  EparagonyEnvironmentValues,
  EparagonyPaymentFormValues,
  EparagonyTaxRateCodeValues,
} from '../../domain/types/eparagony-config.types';

export class EparagonyConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'eparagony.pl') {}

  validate(config: Record<string, unknown>): Promise<void> {
    const issues: FlatValidationIssue[] = [];

    if (!includesValue(EparagonyEnvironmentValues, config.environment)) {
      issues.push({
        path: 'environment',
        message: `must be one of: ${EparagonyEnvironmentValues.join(', ')}`,
      });
    }

    if (typeof config.posId !== 'string' || config.posId.trim().length === 0) {
      issues.push({ path: 'posId', message: 'must be a non-empty string' });
    }

    this.validateTaxRates(config.taxRates, issues);

    if (
      config.defaultTaxRateCode !== undefined &&
      config.defaultTaxRateCode !== null &&
      !includesValue(EparagonyTaxRateCodeValues, config.defaultTaxRateCode)
    ) {
      issues.push({
        path: 'defaultTaxRateCode',
        message: `must be one of: ${EparagonyTaxRateCodeValues.join(', ')}`,
      });
    }

    if (config.print !== undefined && config.print !== null && typeof config.print !== 'boolean') {
      issues.push({ path: 'print', message: 'must be a boolean' });
    }

    if (
      config.paymentForm !== undefined &&
      config.paymentForm !== null &&
      !includesValue(EparagonyPaymentFormValues, config.paymentForm)
    ) {
      issues.push({
        path: 'paymentForm',
        message: `must be one of: ${EparagonyPaymentFormValues.join(', ')}`,
      });
    }

    if (
      config.paymentName !== undefined &&
      config.paymentName !== null &&
      typeof config.paymentName !== 'string'
    ) {
      issues.push({ path: 'paymentName', message: 'must be a string' });
    }

    if (
      config.statusPollTimeoutMs !== undefined &&
      config.statusPollTimeoutMs !== null &&
      (typeof config.statusPollTimeoutMs !== 'number' ||
        !Number.isFinite(config.statusPollTimeoutMs) ||
        config.statusPollTimeoutMs <= 0)
    ) {
      issues.push({ path: 'statusPollTimeoutMs', message: 'must be a positive number' });
    }

    if (
      config.fiscalDeviceUniqueNumber !== undefined &&
      config.fiscalDeviceUniqueNumber !== null &&
      (typeof config.fiscalDeviceUniqueNumber !== 'string' ||
        config.fiscalDeviceUniqueNumber.trim().length === 0)
    ) {
      issues.push({ path: 'fiscalDeviceUniqueNumber', message: 'must be a non-empty string' });
    }

    this.validateUrl(config.apiBaseUrl, 'apiBaseUrl', issues);
    this.validateUrl(config.authBaseUrl, 'authBaseUrl', issues);

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }

  /**
   * A partial rate table is legitimate - the operator overrides only the slots
   * their device programs differently - but every key must be a known slot and
   * every value a non-empty string, because both are transmitted verbatim onto a
   * fiscal document.
   */
  private validateTaxRates(raw: unknown, issues: FlatValidationIssue[]): void {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ path: 'taxRates', message: 'must be an object' });
      return;
    }
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!includesValue(EparagonyTaxRateCodeValues, key)) {
        issues.push({
          path: `taxRates.${key}`,
          message: `is not a known rate slot (expected one of: ${EparagonyTaxRateCodeValues.join(', ')})`,
        });
        continue;
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push({ path: `taxRates.${key}`, message: 'must be a non-empty string' });
      }
    }
  }

  private validateUrl(raw: unknown, path: string, issues: FlatValidationIssue[]): void {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      issues.push({ path, message: 'must be a non-empty string' });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      issues.push({ path, message: 'must be a valid URL' });
      return;
    }
    if (parsed.protocol !== 'https:') {
      issues.push({ path, message: 'must use https' });
    }
  }
}

function includesValue(values: readonly string[], candidate: unknown): boolean {
  return typeof candidate === 'string' && values.includes(candidate);
}
