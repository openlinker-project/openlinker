/**
 * Reporting Currency Setting Domain Entity
 *
 * Singleton-row representation of the system-level currency every order total
 * is additionally stamped in. Read on every stamp attempt; written only by an
 * admin through the settings endpoint.
 *
 * Deliberately system-level rather than per-connection: a per-connection value
 * makes a deployment-wide total impossible BY CONSTRUCTION, which is the
 * problem the stamp exists to solve (ADR-040 Decision 1).
 *
 * @module libs/core/src/currency/domain/entities
 */

export const REPORTING_CURRENCY_SETTING_SINGLETON_ID = 'singleton';

export class ReportingCurrencySetting {
  constructor(
    public readonly reportingCurrency: string,
    public readonly updatedAt: Date,
    public readonly updatedBy: string | null
  ) {}
}
