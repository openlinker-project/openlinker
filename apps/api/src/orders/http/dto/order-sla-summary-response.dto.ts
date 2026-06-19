/**
 * Order SLA Summary Response DTO
 *
 * Response shape for GET /orders/sla-summary (#1108). Carries the count of
 * order records per ship-by SLA bucket for the given source/customer/date
 * scope. The four buckets partition the set, so `total` equals their sum —
 * backs the list-page SLA KPI cells. Mirrors `OrderSlaSummary` in
 * `@openlinker/core/orders`.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

export class OrderSlaSummaryResponseDto {
  @ApiProperty({ description: 'Total order records in scope (sum of the buckets)' })
  total!: number;

  @ApiProperty({ description: 'Orders with a ship-by deadline comfortably ahead (not shipped)' })
  onTrack!: number;

  @ApiProperty({ description: 'Orders within the at-risk window of their ship-by deadline (not shipped)' })
  atRisk!: number;

  @ApiProperty({ description: 'Orders past their ship-by deadline (not shipped)' })
  overdue!: number;

  @ApiProperty({ description: 'Orders with no deadline or already shipped' })
  none!: number;
}
