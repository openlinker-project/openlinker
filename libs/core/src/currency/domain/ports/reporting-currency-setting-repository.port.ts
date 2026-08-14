/**
 * Reporting Currency Setting Repository Port
 *
 * The singleton-row persistence contract, shaped exactly like
 * `AiProviderActiveSettingRepositoryPort`: a `find` that answers `null` when
 * the row has never been written, and an `upsert` that is atomic on the fixed
 * `id`.
 *
 * @module libs/core/src/currency/domain/ports
 */
import type { ReportingCurrencySetting } from '../entities/reporting-currency-setting.entity';

export interface ReportingCurrencySettingRepositoryPort {
  /** `null` when no operator has ever set a reporting currency. */
  findSetting(): Promise<ReportingCurrencySetting | null>;

  upsertSetting(
    reportingCurrency: string,
    updatedBy: string | null
  ): Promise<ReportingCurrencySetting>;
}
