/**
 * Analytics Tax Remediation Controller
 *
 * HTTP surface for the ONE tax-side Data Coverage action that does real work:
 * `POST /analytics/coverage/tax/rerun-backfill` (#2469, epic #2452 Phase 5).
 *
 * Deliberately separate from `AnalyticsRemediationController` (the currency
 * side), because the two are structurally different actions rather than two
 * variants of one:
 *
 *  - **No run ledger, no lifecycle, nothing to poll.** A backfill attempt is
 *    idempotent — it writes a rate only where the catalogue now HAS one and the
 *    line has none — so there is no state that can be left "in progress" and
 *    no reason to record an `analytics_remediation_runs` row. The Phase 1
 *    decision doc scopes that table to the currency category for exactly this
 *    reason.
 *  - **Synchronous.** It triggers the SAME resolution the scheduled
 *    `orders.taxRate.backfill` sweep already runs, just early, over a bounded
 *    set of orders the operator selected. Handing that to a job would add a
 *    poll surface to an action whose whole answer is "how many lines got a
 *    rate", available immediately.
 *
 * **There is no endpoint for tax category A or B, and that is correct.**
 * Category A's fix is a settings toggle (`PUT /analytics/settings`, #2462) that
 * this phase wired into the net-sales query — no data changes at all. Category
 * B genuinely has no resolvable rate anywhere, so an action would be a button
 * that cannot work; the mockup's `detail-novat` state shows the informational
 * row alone, and adding one here would promise a fix that does not exist.
 *
 * @module apps/api/src/analytics/http
 */
import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  TAX_RATE_BACKFILL_SERVICE_TOKEN,
  type ITaxRateBackfillService,
} from '@openlinker/core/orders';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  TaxRerunBackfillRequestDto,
  TaxRerunBackfillResponseDto,
} from './dto/tax-rerun-backfill.dto';

@ApiBearerAuth()
@ApiTags('analytics')
@Controller('analytics/coverage/tax')
export class AnalyticsTaxRemediationController {
  constructor(
    @Inject(TAX_RATE_BACKFILL_SERVICE_TOKEN)
    private readonly backfill: ITaxRateBackfillService
  ) {}

  @Post('rerun-backfill')
  @Roles('admin')
  @ApiOperation({
    summary:
      "Re-resolve the named orders' tax rates from the current catalogue now, instead of waiting for the scheduled sweep",
  })
  @ApiResponse({ status: 201, type: TaxRerunBackfillResponseDto })
  async rerunBackfill(
    @Body() body: TaxRerunBackfillRequestDto
  ): Promise<TaxRerunBackfillResponseDto> {
    // Duplicates in the request are collapsed: the resolution is idempotent, so
    // a repeat is harmless, but counting the same line twice would report
    // `scanned`/`updated` figures the operator cannot reconcile with the list
    // they selected.
    const internalOrderIds = [...new Set(body.internalOrderIds)];
    const result = await this.backfill.backfillOrders(internalOrderIds);

    const dto = new TaxRerunBackfillResponseDto();
    dto.scanned = result.scanned;
    dto.updated = result.updated;
    return dto;
  }
}
