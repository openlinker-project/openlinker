/**
 * Order Summary Projection DTO
 *
 * Neutral order-identity projection (#1995) shared by the Shipments and
 * Invoices list responses, so a row can identify its order (order number,
 * first line-item name/image, item count) without a detail-page round trip.
 * Derived server-side from the order's own snapshot via
 * `buildOrderSummary` (`@openlinker/core/orders`) — no new persistence.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import type { OrderSummary } from '@openlinker/core/orders';

export class OrderSummaryProjectionDto {
  @ApiProperty({
    nullable: true,
    description: 'Source-native order number from the order snapshot; null when absent.',
  })
  orderNumber!: string | null;

  @ApiProperty({
    nullable: true,
    description: "The order's first line item's display name; null when unavailable.",
  })
  firstItemName!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      "The order's first line item's image URL, frozen at order-snapshot time (NOT the live product catalog image); null when the source never populated it.",
  })
  firstItemImageUrl!: string | null;

  @ApiProperty({
    description: "The order's full item count (not the number of items projected here).",
  })
  itemCount!: number;

  static fromSummary(summary: OrderSummary): OrderSummaryProjectionDto {
    const dto = new OrderSummaryProjectionDto();
    dto.orderNumber = summary.orderNumber;
    dto.firstItemName = summary.firstItemName;
    dto.firstItemImageUrl = summary.firstItemImageUrl;
    dto.itemCount = summary.itemCount;
    return dto;
  }
}
