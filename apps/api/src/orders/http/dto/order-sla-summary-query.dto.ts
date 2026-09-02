/**
 * Order SLA Summary Query DTO
 *
 * Query parameters for GET /orders/sla-summary (#1108, #2306). Extends the
 * shared health-summary scope subset (source / customer / date) with the
 * cancellation scope, which is meaningful for the SLA axis and NOT for the
 * health axis — a cancelled order that never shipped still satisfies the
 * repository's `NOT_SHIPPED` guard, so its past deadline would otherwise be
 * counted `overdue`. A separate DTO rather than a field on the shared one so
 * `GET /orders/status-summary` never advertises a parameter it ignores.
 *
 * @module apps/api/src/orders/http/dto
 */
import { IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { OrderHealthSummaryQueryDto } from './order-health-summary-query.dto';

export class OrderSlaSummaryQueryDto extends OrderHealthSummaryQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Cancellation scope (#2306): false counts only non-cancelled orders, true only cancelled ' +
      'ones, omitted does not scope. The dispatch-risk surface passes false so its bucket counts ' +
      'agree with the rows GET /orders returns under the same filter.',
  })
  @IsOptional()
  // Query params arrive as strings, so map the two literals and pass anything else
  // THROUGH unchanged for `@IsBoolean()` to reject with a 400 — the
  // `salesDocumentBlocked` precedent in `list-orders-query.dto.ts`. Collapsing a
  // stray value to `undefined` would silently return UNSCOPED counts.
  @Transform(({ value }): unknown => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  cancelled?: boolean;
}
