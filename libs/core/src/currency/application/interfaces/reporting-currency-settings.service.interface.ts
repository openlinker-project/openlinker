/**
 * Reporting Currency Settings Service Interface
 *
 * Read and write surface for the system-level reporting currency.
 *
 * @module libs/core/src/currency/application/interfaces
 */
import type {
  ReportingCurrencySettingsView,
  SetReportingCurrencyOptions,
} from '../../domain/types/reporting-currency.types';

export interface IReportingCurrencySettingsService {
  /**
   * The effective reporting currency: settings row -> `OL_REPORTING_CURRENCY`
   * -> `DEFAULT_REPORTING_CURRENCY`. Never throws on a bad env value.
   */
  resolve(): Promise<string>;

  /** The effective value plus the provenance and audit fields the UI renders. */
  getView(): Promise<ReportingCurrencySettingsView>;

  /**
   * Validate and persist an operator's choice.
   *
   * @throws InvalidReportingCurrencyError bad ISO shape - maps to 400
   * @throws ReportingCurrencyUnsupportedError unreachable code - maps to 422
   */
  setReportingCurrency(
    code: string,
    updatedBy: string | null,
    options?: SetReportingCurrencyOptions
  ): Promise<ReportingCurrencySettingsView>;

  /**
   * The currencies a save would accept right now: the supported set narrowed
   * to what the registered providers can reach. A pure array test - no I/O, no
   * cache - so validation never depends on a provider being up.
   */
  listSelectableCurrencies(): readonly string[];
}
