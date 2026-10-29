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
  LineStockRestored,
  DiscountPaymentBranch} from '../../application/types/order-edit.types';
import type {
  DiscountCorrectionUnavailableReason,
  OrderDiscountOutcome,
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
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'The whole-order discount the channel itself applied; null when the channel reported none.',
  })
  channelDiscountTotal!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Channel discount + OpenLinker discount; null only when neither exists.',
  })
  combinedDiscountTotal!: number | null;
  @ApiProperty({ description: 'Always false: OpenLinker computes no tax, so `tax` stays the channel figure.' })
  taxRestated!: false;
}

export class UnmatchedLineEditDto {
  @ApiProperty() orderLineId!: string;
  @ApiProperty() editedQuantity!: number;
  @ApiProperty() editedAt!: string;
}

export class OrderEditHistoryEntryDto {
  @ApiProperty() changeId!: string;
  @ApiProperty({
    enum: [
      'order.address_change',
      'order.line_quantity_change',
      'order.delivery_method_change',
      'order.discount_change',
    ],
  })
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
  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      'The current order discount (`{ amount, currency, perLine, changeId, editedAt, editedBy }`, amounts ' +
      'are decimal strings in the order currency), or null. `totals` already includes it.',
  })
  discount!: OrderEditsView['discount'];
  @ApiProperty({
    type: [Object],
    description:
      'Open discount proposals waiting for the operator: `order.discount_refund` (confirm = the seller refunded ' +
      'on the channel) and `order.discount_correction` (confirm = issue the correction). Confirm with ' +
      'POST /orders/:id/changes/:changeId/confirm.',
  })
  discountProposals!: OrderEditsView['discountProposals'];
  @ApiProperty({ nullable: true, type: Object, description: '`{ channelAmount, amount, currency }`, or null.' })
  cod!: OrderEditsView['cod'];
  @ApiProperty({
    type: [UnmatchedLineEditDto],
    description:
      'Line edits whose line id the channel no longer reports. Kept, not applied, and not restated ' +
      'in the totals; the operator re-does them on the current lines.',
  })
  unmatchedLineEdits!: readonly UnmatchedLineEditDto[];
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

export class OrderDiscountTotalsDto {
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'What the buyer paid on the channel.' }) channelTotal!: number;
  @ApiProperty({ description: 'The order total after the discount (and any quantity edit).' }) total!: number;
  @ApiProperty({ description: '`channelTotal - total`.' }) difference!: number;
}

export class OrderDiscountResponseDto {
  @ApiProperty() dryRun!: boolean;
  @ApiProperty({ nullable: true, type: String, description: 'The saved discount change; null for a dry run.' })
  changeId!: string | null;
  @ApiProperty({
    nullable: true,
    type: Object,
    description: 'The current discount, or null once removed.',
  })
  discount!: OrderDiscountOutcome['discount'];
  @ApiProperty({ type: OrderDiscountTotalsDto, nullable: true }) totals!: OrderDiscountTotalsDto | null;
  @ApiProperty({ enum: ['paid', 'cod', 'unpaid', 'unknown'] }) paymentBranch!: DiscountPaymentBranch;
  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      '`{ amount, currency }` still to collect (the discounted total, or the COD amount); null on a paid order.',
  })
  amountToCollect!: OrderDiscountOutcome['amountToCollect'];
  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      'Paid orders: `{ changeId, amount, currency, ceiling }`. `ceiling` is the #3289 verdict at creation: ' +
      '`within`, `exceeded` (acknowledged) or `unknown` (proceeded unchecked).',
  })
  refundIntent!: OrderDiscountOutcome['refundIntent'];
  @ApiProperty({ description: 'The refund intent could not be opened after the discount was saved; the discount stands.' })
  refundIntentFailed!: boolean;
  @ApiProperty({
    nullable: true,
    type: Object,
    description:
      'An issued invoice: `{ changeId, invoiceRecordId, documentNumber, currency, lines }`, to confirm.',
  })
  correctionProposal!: OrderDiscountOutcome['correctionProposal'];
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Why an issued document could not be given a correction proposal.',
  })
  correctionUnavailableReason!: DiscountCorrectionUnavailableReason | null;
  @ApiProperty({ type: OrderEditsViewDto }) view!: OrderEditsViewDto;

  static from(result: OrderEditResult): OrderDiscountResponseDto {
    const outcome = result.discount as OrderDiscountOutcome;
    return Object.assign(new OrderDiscountResponseDto(), {
      dryRun: result.dryRun,
      changeId: result.changeId,
      discount: outcome.discount,
      totals:
        result.view.totals === null
          ? null
          : {
              currency: result.view.totals.currency,
              channelTotal: result.view.totals.channelTotal,
              total: result.view.totals.total,
              difference: result.view.totals.difference,
              channelDiscountTotal: result.view.totals.channelDiscountTotal,
              combinedDiscountTotal: result.view.totals.combinedDiscountTotal,
            },
      paymentBranch: outcome.paymentBranch,
      amountToCollect: outcome.amountToCollect,
      refundIntent: outcome.refundIntent,
      refundIntentFailed: outcome.refundIntentFailed,
      correctionProposal: outcome.correctionProposal,
      correctionUnavailableReason: outcome.correctionUnavailableReason,
      view: result.view,
    });
  }
}
