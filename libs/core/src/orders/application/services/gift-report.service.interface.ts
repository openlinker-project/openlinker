/**
 * Gift Report Service Interface (#3943)
 *
 * The facts behind the "Gift cost" report, the per-customer CSV and the bundle
 * view. A read over orders already ingested; it writes nothing.
 *
 * @module libs/core/src/orders/application/services
 */
import type {
  BundleReport,
  GiftReportEntry,
  GiftReportFilters,
} from '../../domain/types/gift-report.types';

export interface IGiftReportService {
  /**
   * Every gift the ready, uncancelled orders in the range carry, one entry per
   * gift line or bundle gift slot. A cancelled order gave nothing away, so it is
   * not in the report. Throws nothing for an unknown cost: that is a `null`.
   */
  listEntries(filters: GiftReportFilters): Promise<GiftReportEntry[]>;

  /** Bundle sales (units, net revenue, component cost, margin) and the demand they put on components. */
  getBundleReport(filters: Omit<GiftReportFilters, 'giftSource'>): Promise<BundleReport>;
}
