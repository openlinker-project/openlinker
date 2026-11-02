/**
 * Product Cost Reads Service Interface (#3588)
 *
 * The API-layer composition behind `GET /products/cost-coverage*` and
 * `GET /products/variants/cost-worklist*`: core's `ICostCoverageService` plus
 * the per-request Net-Sales opt-in and the display metadata (names, SKUs,
 * attributes, connection names) core must not fetch for itself.
 *
 * @module apps/api/src/products/application/services
 */
import type {
  CostCoverageResponseDto,
  CostSummaryResponseDto,
  CostWorklistResponseDto,
} from '../../http/dto/cost-coverage.dto';
import type { CostWorklistCountFilters, CostWorklistFilters } from '@openlinker/core/orders';

export const PRODUCT_COST_READS_SERVICE_TOKEN = Symbol('IProductCostReadsService');

export interface IProductCostReadsService {
  getCostCoverage(days: number): Promise<CostCoverageResponseDto>;
  getSummary(): Promise<CostSummaryResponseDto>;
  getWorklist(filters: CostWorklistFilters, withTotal: boolean): Promise<CostWorklistResponseDto>;
  countWorklist(filters: CostWorklistCountFilters): Promise<number>;
}
