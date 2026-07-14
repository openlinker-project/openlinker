/**
 * KSeF Connection Config Shape Validator
 *
 * Validates the non-secret config for a KSeF connection: a required `env`
 * selecting the target environment (`test` | `demo` | `prod`), an optional
 * `seller.defaultTaxRate` check (must be a known `FA3_TAX_RATE_MAP` key when
 * present, #1291) so a mistyped rate is rejected at connection-save time
 * instead of surfacing as `UnmappedTaxRateException` at issuance, and an
 * optional `payment` check (#1311): `payment`, `payment.bankAccount` and
 * `payment.skonto` must themselves be objects when present (a wrong-typed
 * value would otherwise be silently dropped at issuance), `formaPlatnosci` must be a valid
 * `TFormaPlatnosci` code, `bankAccount.nrRb` must be non-empty, free of inner
 * whitespace, and 10-34 characters long (per the XSD `TNrRB` pattern) when
 * `bankAccount` is set — the FE strips whitespace via `normalizeNrRb` before
 * submitting, but a direct API write bypasses that, and a spaced NRB would
 * fail KSeF's `TNrRB` pattern at clearance,
 * `paymentTermDays` must be an integer in 0-999 (sanity cap — the XSD `Ilosc`
 * type is unbounded, so a fat-fingered term would otherwise reach the wire), and
 * `skonto.conditions`/`skonto.amount` must both be non-empty when `skonto` is
 * set (a partial skonto is otherwise silently dropped at issuance by the
 * factory's `resolvePayment`, so rejecting it at save time gives the operator
 * a clear error instead). The seller's tax identifier itself (`nip`/`name`/`address`) is intentionally
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
    // A wrong-typed `payment` (or sub-object below) is rejected here rather
    // than silently dropped at issuance by the factory's `resolvePayment` —
    // this validator is the strict save-time gate.
    if (payment !== undefined && (payment === null || typeof payment !== 'object')) {
      issues.push({ path: 'payment', message: 'must be an object' });
    } else if (payment !== undefined) {
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
      if (p.bankAccount !== undefined && (p.bankAccount === null || typeof p.bankAccount !== 'object')) {
        issues.push({ path: 'payment.bankAccount', message: 'must be an object' });
      } else if (p.bankAccount !== undefined) {
        const nrRb = (p.bankAccount as Record<string, unknown>).nrRb;
        if (typeof nrRb !== 'string' || nrRb.trim().length === 0) {
          issues.push({
            path: 'payment.bankAccount.nrRb',
            message: 'must be a non-empty string when bankAccount is set',
          });
        } else if (/\s/.test(nrRb.trim())) {
          // The FE strips whitespace at assembly time (`normalizeNrRb`); a
          // direct API write must arrive already stripped — inner spaces
          // would be emitted verbatim into <NrRB> and fail KSeF's TNrRB
          // pattern at clearance (PR #1317 review).
          issues.push({
            path: 'payment.bankAccount.nrRb',
            message: 'must not contain whitespace (submit the account number without spaces)',
          });
        } else if (nrRb.trim().length < 10 || nrRb.trim().length > 34) {
          issues.push({
            path: 'payment.bankAccount.nrRb',
            message: 'must be 10-34 characters long (per the FA(3) TNrRB pattern)',
          });
        }
      }
      // Upper bound is a sanity cap (PR #1317 review): the XSD `Ilosc` type is
      // unbounded so a fat-fingered `1400` would clear KSeF fine — but no real
      // payment term needs four digits. Mirrored by the FE schema's 999 cap.
      if (
        p.paymentTermDays !== undefined &&
        (typeof p.paymentTermDays !== 'number' ||
          !Number.isInteger(p.paymentTermDays) ||
          p.paymentTermDays < 0 ||
          p.paymentTermDays > 999)
      ) {
        issues.push({
          path: 'payment.paymentTermDays',
          message: 'must be an integer between 0 and 999',
        });
      }
      if (p.skonto !== undefined && (p.skonto === null || typeof p.skonto !== 'object')) {
        issues.push({ path: 'payment.skonto', message: 'must be an object' });
      } else if (p.skonto !== undefined) {
        const skonto = p.skonto as Record<string, unknown>;
        const hasConditions = typeof skonto.conditions === 'string' && skonto.conditions.trim().length > 0;
        const hasAmount = typeof skonto.amount === 'string' && skonto.amount.trim().length > 0;
        if (!hasConditions || !hasAmount) {
          issues.push({
            path: 'payment.skonto',
            message: 'both conditions and amount must be non-empty strings when skonto is set',
          });
        }
      }
    }

    // Per-line issuance defaults (#1525). `lineUnit` is free text emitted as
    // FaWiersz/P_8A; an empty/whitespace-only value is treated as absent (the
    // factory's `resolveDefaultLineUnit` drops it), so only a wrong type or an
    // over-long value is rejected. The 20-char cap is a sanity limit, not an
    // XSD constraint (P_8A is unbounded TZnakowy).
    const invoiceDefaults = config.invoiceDefaults;
    if (
      invoiceDefaults !== undefined &&
      (invoiceDefaults === null || typeof invoiceDefaults !== 'object')
    ) {
      issues.push({ path: 'invoiceDefaults', message: 'must be an object' });
    } else if (invoiceDefaults !== undefined) {
      const lineUnit = (invoiceDefaults as Record<string, unknown>).lineUnit;
      if (lineUnit !== undefined) {
        if (typeof lineUnit !== 'string') {
          issues.push({ path: 'invoiceDefaults.lineUnit', message: 'must be a string' });
        } else if (lineUnit.trim().length > 20) {
          issues.push({
            path: 'invoiceDefaults.lineUnit',
            message: 'must be at most 20 characters after trimming',
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
