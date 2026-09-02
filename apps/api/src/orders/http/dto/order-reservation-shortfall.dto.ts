/**
 * Order Reservation Shortfall DTO (#2349)
 *
 * One still-open shortfall episode, projected onto the order detail.
 *
 * **Deliberately not named `stockAtRisk`.** `libs/core/src/listings` already
 * owns `StockAtRiskItem.shortfall`, which answers a different question — *which
 * LISTING is about to stop selling* — keyed by variant rather than by order.
 * Two unrelated numbers sharing one name across two contexts would leave a
 * consumer unable to tell which it was rendering. The operator-facing COPY is
 * free to say "stock at risk"; the contract name is not.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderReservationShortfallDto {
  @ApiProperty({
    description:
      'Stable occurrence id for this shortfall episode. Opened once on the ' +
      'transition into shortfall and closed by an explicit write, so an ' +
      'edge-triggered automation can key an idempotency key on it. A ' +
      'recurrence after a close carries a NEW id.',
  })
  episodeId!: string;

  @ApiProperty({ description: 'The inventory position the shortfall was observed on.' })
  inventoryItemId!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Internal variant id, or null for a product-level position.',
  })
  productVariantId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Sku as it read when the episode opened. Null when the variant carries ' +
      'no sku, or when it could not be resolved — the order and variant are ' +
      'still named either way.',
  })
  sku!: string | null;

  @ApiProperty({
    description:
      "This order's attributed share of the shortfall. Attribution is " +
      'youngest-reservation-first: a stated OpenLinker policy ("the last ' +
      'promise made is the one at risk"), not an inference about which buyer ' +
      'will go unserved.',
  })
  shortQuantity!: number;

  @ApiProperty({
    description:
      "The whole position's shortfall when the episode opened, so an operator " +
      'can tell this order\'s share from the total exposure.',
  })
  positionShortfall!: number;

  @ApiProperty({ description: 'When the episode opened (ISO 8601).' })
  openedAt!: string;
}
