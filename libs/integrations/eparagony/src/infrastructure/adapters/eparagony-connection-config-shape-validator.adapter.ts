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
 * THE INVOICE KEYS ARE HELD TO THE SAME RULE (#3192), and for a sharper reason:
 * `merchantTIN`, `merchantName` and `merchantAddress` are transmitted onto a
 * fiscal document AND persisted into the issued-document snapshot core keeps, so
 * a half-filled `merchantAddress` would put `"undefined undefined"` on a stored
 * seller party, and a STRING `"true"` for `eInvoicingHubEnabled` fails the
 * adapter's `=== true` test and silently issues outside the national hub - no
 * error, and a legally different document. `config` is JSONB, so the TypeScript
 * type is no runtime guarantee, and the connection form emits only
 * `{environment, posId}` - the raw JSON editor is the operator's route to every
 * key below, which is exactly the bypass #2610 requires a server-side check for.
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

    this.validateNonEmptyString(config.merchantTIN, 'merchantTIN', issues);
    this.validateNonEmptyString(config.merchantName, 'merchantName', issues);
    this.validateSellerAddress(config.merchantAddress, issues);

    if (
      config.eInvoicingHubEnabled !== undefined &&
      config.eInvoicingHubEnabled !== null &&
      typeof config.eInvoicingHubEnabled !== 'boolean'
    ) {
      // Not coerced. A string "true" here would read as false at the adapter's
      // `=== true` test and issue OUTSIDE the hub, which is a different document
      // with no error anywhere - so the operator is told rather than guessed for.
      issues.push({
        path: 'eInvoicingHubEnabled',
        message: 'must be a boolean (true or false, not the strings "true" / "false")',
      });
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

  /**
   * A seller party the vendor stamps on the document and core persists.
   *
   * Every part is checked individually rather than the object as a whole,
   * because a PARTIAL address is the dangerous shape: the invoice mapper renders
   * `line1` as `` `${street} ${number}` ``, so a missing half becomes the literal
   * `"undefined undefined"` inside the issued-document snapshot, where an
   * operator reads it as the seller's real address.
   */
  private validateSellerAddress(raw: unknown, issues: FlatValidationIssue[]): void {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ path: 'merchantAddress', message: 'must be an object' });
      return;
    }
    const address = raw as Record<string, unknown>;
    for (const field of ['street', 'number', 'postalCode', 'city', 'country'] as const) {
      const value = address[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push({
          path: `merchantAddress.${field}`,
          message: 'must be a non-empty string',
        });
      }
    }
    // The one genuinely optional part - a seller with no apartment is ordinary -
    // but an empty one would be transmitted as a blank line on the document.
    this.validateNonEmptyString(address.apartment, 'merchantAddress.apartment', issues);
  }

  /** An optional string that is transmitted verbatim, so blanks are refused too. */
  private validateNonEmptyString(raw: unknown, path: string, issues: FlatValidationIssue[]): void {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      issues.push({ path, message: 'must be a non-empty string' });
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
