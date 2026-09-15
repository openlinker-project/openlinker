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

/**
 * Seller-address parts the vendor requires on every `EntityAddress`. `apartment`
 * is the one optional part and is checked separately, so it is absent here.
 */
const REQUIRED_MERCHANT_ADDRESS_PARTS = [
  'street',
  'number',
  'postalCode',
  'city',
  'country',
] as const;

/** ISO 3166-1 alpha-2, which is what `EparagonySellerAddress.country` declares. */
const ISO_ALPHA2_PATTERN = /^[A-Za-z]{2}$/;

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

    // The invoice lane's four keys (#3192). ALL FOUR ARE OPTIONAL and must stay
    // so: every connection that exists today is receipts-only and carries none
    // of them, and `ConnectionService` re-validates the whole config on every
    // save - so promoting one to required would refuse an existing connection's
    // own stored config the next time an operator touched an unrelated field.
    // What the invoice lane actually needs is enforced where it is needed, by
    // `composeInvoiceDocument` refusing pre-call.
    //
    // Non-empty rather than merely string-typed, for `merchantTIN` and
    // `merchantName` alike: the mapper reads both through `readNonEmpty`, so a
    // blank one is silently treated as absent. Refusing it here turns
    // configured-but-ignored into a form error the operator can see.
    if (
      config.merchantTIN !== undefined &&
      config.merchantTIN !== null &&
      (typeof config.merchantTIN !== 'string' || config.merchantTIN.trim().length === 0)
    ) {
      issues.push({ path: 'merchantTIN', message: 'must be a non-empty string' });
    }

    if (
      config.merchantName !== undefined &&
      config.merchantName !== null &&
      (typeof config.merchantName !== 'string' || config.merchantName.trim().length === 0)
    ) {
      issues.push({ path: 'merchantName', message: 'must be a non-empty string' });
    }

    this.validateMerchantAddress(config.merchantAddress, issues);

    if (
      config.eInvoicingHubEnabled !== undefined &&
      config.eInvoicingHubEnabled !== null &&
      typeof config.eInvoicingHubEnabled !== 'boolean'
    ) {
      issues.push({ path: 'eInvoicingHubEnabled', message: 'must be a boolean' });
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
   * The seller's own address, in the vendor's five-part shape.
   *
   * Every part is validated here because NOTHING downstream does:
   * `toSellerEntityAddress` copies the operator's object across field by field
   * with no interpretation, which is deliberate (OpenLinker must not guess where
   * a building number ends) and leaves this the only gate. That is the asymmetry
   * with the BUYER's address, which core hands over already typed - its country
   * arrives as `countryIso2`, while this one is free text an operator typed.
   *
   * Partial is refused rather than tolerated: an address missing its postcode is
   * not a partial address the vendor completes, it is a rejected document, and
   * `toIssuedDocumentSeller` reports a seller block only when name, tax number
   * and address are all present anyway.
   *
   * The country check is a SHAPE check, not a canonicalisation - this port
   * returns `Promise<void>` and cannot write a normalised value back, so it
   * accepts either case and leaves the vendor the authority on that. It still
   * catches the mistake worth catching, a country spelled out in full.
   */
  private validateMerchantAddress(raw: unknown, issues: FlatValidationIssue[]): void {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ path: 'merchantAddress', message: 'must be an object' });
      return;
    }
    const address = raw as Record<string, unknown>;

    for (const part of REQUIRED_MERCHANT_ADDRESS_PARTS) {
      const value = address[part];
      if (typeof value !== 'string' || value.trim().length === 0) {
        issues.push({ path: `merchantAddress.${part}`, message: 'must be a non-empty string' });
      }
    }

    if (typeof address.country === 'string' && !ISO_ALPHA2_PATTERN.test(address.country.trim())) {
      issues.push({
        path: 'merchantAddress.country',
        message: 'must be a two-letter ISO 3166-1 alpha-2 country code',
      });
    }

    if (
      address.apartment !== undefined &&
      address.apartment !== null &&
      (typeof address.apartment !== 'string' || address.apartment.trim().length === 0)
    ) {
      issues.push({ path: 'merchantAddress.apartment', message: 'must be a non-empty string' });
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
