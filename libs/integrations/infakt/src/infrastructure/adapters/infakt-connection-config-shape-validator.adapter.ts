/**
 * Infakt Connection Config Shape Validator
 *
 * Validates the non-secret config for an Infakt connection: an optional
 * `baseUrl` override (sandbox vs production) that, when present, must be a
 * non-empty, well-formed URL; an optional `defaultPaymentMethod` (#1303)
 * that, when present, must be one of `InfaktPaymentMethodValues`; and an
 * optional `bankAccount` snapshot (#1303 follow-up) that, when present, must
 * carry an `id` (string or legacy number) plus non-empty `accountNumber` and
 * `bankName` strings — the adapter stamps the latter two straight onto
 * `'transfer'` invoices, so a malformed shape must fail fast at save time
 * (400) rather than surface as an opaque inFakt 422 at issuance. Registered
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

    this.validateBankAccount(config.bankAccount, issues);

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }

  /**
   * When `bankAccount` is present it must be a plain object with an `id`
   * (string, or number for legacy rows the FE coerces on read) plus non-empty
   * `accountNumber` and `bankName` strings. `null`/`undefined` are accepted
   * (no bank account configured).
   */
  private validateBankAccount(raw: unknown, issues: FlatValidationIssue[]): void {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ path: 'bankAccount', message: 'must be an object' });
      return;
    }
    const account = raw as Record<string, unknown>;
    const { id, accountNumber, bankName } = account;

    if (typeof id !== 'string' && typeof id !== 'number') {
      issues.push({ path: 'bankAccount.id', message: 'must be a string or number' });
    }
    if (typeof accountNumber !== 'string' || accountNumber.trim().length === 0) {
      issues.push({ path: 'bankAccount.accountNumber', message: 'must be a non-empty string' });
    }
    if (typeof bankName !== 'string' || bankName.trim().length === 0) {
      issues.push({ path: 'bankAccount.bankName', message: 'must be a non-empty string' });
    }
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
