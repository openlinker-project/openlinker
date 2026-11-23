/**
 * Mirakl Connection Config Shape Validator
 *
 * Validates the non-secret config of a Mirakl connection. Every key is
 * optional:
 *
 * - `environment`: `production` or `staging`.
 * - `shopId`: a positive integer, as a number or a digit string.
 * - `orderAcceptance`: `auto` or `off`.
 * - `carrierCodes`: an object of non-empty strings (`platformType` -> SH21 code).
 * - `offerDefaults`: `leadTimeToShip` 0-30 days, `logisticClass` a non-empty code.
 * - `masterCatalogConnectionId`: a UUID (the shared catalogue pairing key).
 * - `baseUrl`: refused. The base URL comes from the operator profile only, so
 *   a connection can never point its key at another host; a stored `baseUrl`
 *   would do nothing and suggest otherwise.
 *
 * Other keys pass through, because the host writes generic ones (`rateLimit`,
 * `stockSafetyBuffer`, `pricingRule`) and validates them itself.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @see {@link ConnectionConfigShapeValidatorPort}
 */
import {
  type ConnectionConfigShapeValidatorPort,
  type FlatValidationIssue,
  InvalidConnectionConfigException,
} from '@openlinker/core/integrations';
import {
  isMiraklEnvironment,
  isMiraklOrderAcceptance,
  readMiraklCarrierCodes,
  readMiraklOfferDefaults,
  readMiraklShopId,
} from '../../domain/policies/mirakl-connection-config.policy';
import {
  MiraklEnvironmentValues,
  MiraklOrderAcceptanceValues,
} from '../../domain/types/mirakl-connection.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MiraklConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly brand: string) {}

  validate(config: Record<string, unknown>): Promise<void> {
    const issues: FlatValidationIssue[] = [];

    if (config.environment !== undefined && !isMiraklEnvironment(config.environment)) {
      issues.push({
        path: 'environment',
        message: `must be one of: ${MiraklEnvironmentValues.join(', ')}`,
      });
    }
    if (readMiraklShopId(config.shopId).kind === 'invalid') {
      issues.push({ path: 'shopId', message: 'must be a positive integer' });
    }
    if (config.orderAcceptance !== undefined && !isMiraklOrderAcceptance(config.orderAcceptance)) {
      issues.push({
        path: 'orderAcceptance',
        message: `must be one of: ${MiraklOrderAcceptanceValues.join(', ')}`,
      });
    }
    if (readMiraklCarrierCodes(config.carrierCodes).kind === 'invalid') {
      issues.push({
        path: 'carrierCodes',
        message: 'must map shipping platform types to non-empty carrier codes',
      });
    }
    if (readMiraklOfferDefaults(config.offerDefaults).kind === 'invalid') {
      issues.push({
        path: 'offerDefaults',
        message: 'leadTimeToShip must be 0-30 days and logisticClass a non-empty code',
      });
    }
    if (config.baseUrl !== undefined) {
      issues.push({
        path: 'baseUrl',
        message: 'is not supported; the API address follows from `environment`',
      });
    }
    const master = config.masterCatalogConnectionId;
    if (master !== undefined && master !== null && master !== '') {
      if (typeof master !== 'string' || !UUID_PATTERN.test(master)) {
        issues.push({ path: 'masterCatalogConnectionId', message: 'must be a valid UUID' });
      }
    }

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.brand, issues));
    }
    return Promise.resolve();
  }
}
