/**
 * Order Edit Response DTOs (#3542)
 *
 * The order beside the channel's own record of it: every figure is given twice,
 * what the channel reported and what the order is after the edit, so no surface
 * has to compute either.
 *
 * @module apps/api/src/orders/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';

import {
  LineStockRestored} from '../../application/types/order-edit.types';
import type {
  OrderEditHistoryEntry,
  OrderEditResult,
  OrderEditsView,
} from '../../application/types/order-edit.types';

export class OrderEditLineStockDto {
  @ApiProperty() orderLineId!: string;

  @ApiProperty({
    description:
      'true = the product master was given the units back; false = it was not (see `detail`); ' +
      '"not-applicable" = nothing was ever taken for this line, so there is nothing to give back.',
    oneOf: [{ type: 'boolean' }, { type: 'string', enum: ['not-applicable'] }],
  })
  stockRestored!: LineStockRestored;

  @ApiProperty({ nullable: true, type: String }) detail!: string | null;
}

export class OrderEditsLineViewDto {
  @ApiProperty() orderLineId!: string;
  @ApiProperty({ description: 'What the channel reported.' }) channelQuantity!: number;
  @ApiProperty({ description: 'What the order says after the edit.' }) quantity!: number;
}

export class OrderEditedTotalsDto {
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'What the buyer paid on the channel.' }) channelTotal!: number;
  @ApiProperty({ description: 'The order total after the edit.' }) total!: number;
  @ApiProperty({
    description:
      '`channelTotal - total`. Informational only: no refund intent is created (the discount money event owns that).',
  })
  difference!: number;
  @ApiProperty({ description: 'Always false: OpenLinker computes no tax, so `tax` stays the channel figure.' })
  taxRestated!: false;
}

export class OrderEditHistoryEntryDto {
  @ApiProperty() changeId!: string;
  @ApiProperty({ enum: ['order.address_change', 'order.line_quantity_change', 'order.delivery_method_change'] })
  kind!: OrderEditHistoryEntry['kind'];
  @ApiProperty() at!: string;
  @ApiProperty({ nullable: true, type: String }) byUserId!: string | null;
  @ApiProperty({ description: 'No channel supports these edits, so the channel always keeps its original.' })
  channelKeeps!: true;
  @ApiProperty() channelConnectionId!: string;
}

export class OrderEditsViewDto {
  @ApiProperty() editedAt!: string;
  @ApiProperty({ nullable: true, type: Object, description: '`{ original, current }` shipping address, or null.' })
  address!: OrderEditsView['address'];
  @ApiProperty({ type: [OrderEditsLineViewDto] }) lines!: readonly OrderEditsLineViewDto[];
  @ApiProperty({ nullable: true, type: Object, description: '`{ original, current }` delivery method, or null.' })
  deliveryMethod!: OrderEditsView['deliveryMethod'];
  @ApiProperty({ nullable: true, type: OrderEditedTotalsDto }) totals!: OrderEditedTotalsDto | null;
  @ApiProperty({ nullable: true, type: Object, description: '`{ channelAmount, amount, currency }`, or null.' })
  cod!: OrderEditsView['cod'];
  @ApiProperty({ type: [OrderEditHistoryEntryDto] }) history!: readonly OrderEditHistoryEntryDto[];
}

export class OrderEditResponseDto {
  @ApiProperty() dryRun!: boolean;
  @ApiProperty({ nullable: true, type: String, description: 'The saved change; null for a dry run.' })
  changeId!: string | null;
  @ApiProperty({ type: OrderEditsViewDto }) view!: OrderEditsViewDto;
  @ApiProperty({ type: [OrderEditLineStockDto], description: 'Lines edit only.' })
  stock!: OrderEditLineStockDto[];

  static from(result: OrderEditResult): OrderEditResponseDto {
    return Object.assign(new OrderEditResponseDto(), {
      dryRun: result.dryRun,
      changeId: result.changeId,
      view: result.view,
      stock: [...result.stock],
    });
  }
}
