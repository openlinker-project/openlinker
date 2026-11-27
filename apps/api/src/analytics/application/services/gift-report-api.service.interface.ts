/**
 * Gift Report API Service Interface (#3943)
 *
 * Composes the core gift report (`orders`) with the promotion names
 * (`automation`), component availability (`inventory`) and customer names
 * (`customers`) the screen and the accountant's file need. Composed here, at the
 * app layer, because no single core context owns all of them.
 *
 * @module apps/api/src/analytics/application/services
 */
import type { GiftReportEntry, GiftReportFilters } from '@openlinker/core/orders';
import type {
  BundleReportResponseDto,
  GiftReportResponseDto,
} from '../../http/dto/gift-report.dto';

export const GIFT_REPORT_API_SERVICE_TOKEN = Symbol('IGiftReportApiService');

/** One row of the per-customer export. */
export interface GiftCustomerExportRow {
  entry: GiftReportEntry;
  customerName: string | null;
  ruleName: string | null;
}

export interface IGiftReportApiService {
  getReport(filters: GiftReportFilters): Promise<GiftReportResponseDto>;
  getBundleReport(filters: Omit<GiftReportFilters, 'giftSource'>): Promise<BundleReportResponseDto>;
  /** Every gift in the range, oldest first, each with its resolved customer's name when stored. */
  getCustomerExportRows(filters: GiftReportFilters): Promise<GiftCustomerExportRow[]>;
}
