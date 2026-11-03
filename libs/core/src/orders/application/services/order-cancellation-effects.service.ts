/**
 * Order Cancellation Effects Service (#3540, B-18)
 *
 * See the interface for why this exists. In short: cancel fulfilment work with
 * `order_cancelled`, release the order's open hold, abandon any open discount
 * proposal (B-31), and for an invoiced order open the credit proposal - once,
 * whichever path observed the cancel first.
 *
 * It lives in core because ingestion (core) must run it for an observed
 * confirmation and core may not import `apps/api`.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderCancellationEffectsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  FULFILLMENT_ORDER_CANCELLATION_SERVICE_TOKEN,
  type IFulfillmentOrderCancellationService,
} from '@openlinker/core/fulfillment';
import {
  INVOICE_SERVICE_TOKEN,
  type IInvoiceService,
  type InvoiceRecord,
} from '@openlinker/core/invoicing';
import { Logger } from '@openlinker/shared/logging';
import type { OrderChange } from '../../domain/entities/order-change.entity';
import {
  ORDER_CANCELLED_HOLD_RELEASE_NOTE,
  type OrderCancelCorrectionPayload,
  type OrderCancelCorrectionProposal,
  type OrderCancelCorrectionUnavailableReason,
} from '../../domain/types/order-cancel.types';
import { cancelCorrectionTargetRef } from '../../domain/types/order-change.types';
import type {
  OrderLabelVoiderPort,
  OrderLabelVoidOutcome,
} from '../../domain/ports/order-label-voider.port';
import {
  ORDER_CHANGE_SERVICE_TOKEN,
  ORDER_HOLD_SERVICE_TOKEN,
  ORDER_LABEL_VOIDER_TOKEN,
} from '../../orders.tokens';
import type {
  ApplyOrderCancellationEffectsInput,
  IOrderCancellationEffectsService,
  OrderCancellationEffectsResult,
} from '../interfaces/order-cancellation-effects.service.interface';
import { IOrderHoldService } from '../interfaces/order-hold.service.interface';
import { IOrderChangeService } from './order-change.service.interface';

/** Proposal kinds a discount opens; the cancel credit supersedes both. */
const DISCOUNT_PROPOSAL_KINDS: ReadonlySet<string> = new Set([
  'order.discount_refund',
  'order.discount_correction',
]);
const DISCOUNT_PROPOSAL_ABANDON_REASON = 'order-cancelled';

@Injectable()
export class OrderCancellationEffectsService implements IOrderCancellationEffectsService {
  private readonly logger = new Logger(OrderCancellationEffectsService.name);

  constructor(
    @Inject(FULFILLMENT_ORDER_CANCELLATION_SERVICE_TOKEN)
    private readonly fulfillmentCancellation: IFulfillmentOrderCancellationService,
    @Inject(ORDER_HOLD_SERVICE_TOKEN)
    private readonly holds: IOrderHoldService,
    @Inject(ORDER_CHANGE_SERVICE_TOKEN)
    private readonly changes: IOrderChangeService,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    private readonly moduleRef: ModuleRef
  ) {}

  async applyEffects(
    input: ApplyOrderCancellationEffectsInput
  ): Promise<OrderCancellationEffectsResult> {
    const cancelledWorkIds = await this.cancelWork(input.internalOrderId, input.cancelledAt);
    const releasedHoldIds = await this.releaseHolds(input);
    const labelVoids = input.voidLabels === false ? [] : await this.voidLabels(input);
    await this.abandonDiscountProposals(input.internalOrderId);

    let correctionProposal: OrderCancelCorrectionProposal | null = null;
    let correctionUnavailableReason: OrderCancelCorrectionUnavailableReason | null = null;
    // The document that actually EXISTS, not the newest row (B-19): a later
    // failed or rejected attempt would otherwise mask the issued invoice and
    // leave the credit unproposed.
    let issued: InvoiceRecord | null = null;
    try {
      issued = await this.invoices.getLatestIssuedInvoiceForOrder(input.internalOrderId);
    } catch (error) {
      this.logger.error(
        `Failed to read the issued invoice for cancelled order ${input.internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      correctionUnavailableReason = 'proposal-failed';
    }
    if (issued) {
      const proposed = await this.proposeCreditCorrection(input, issued);
      correctionProposal = proposed.proposal;
      correctionUnavailableReason = proposed.unavailable;
    }

    return { cancelledWorkIds, releasedHoldIds, labelVoids, correctionProposal, correctionUnavailableReason };
  }

  /**
   * Void the labels OpenLinker bought for the order. Best-effort: the channel has
   * already cancelled, so a label that cannot be voided is reported and the rest
   * of the cleanup carries on. The voider lives in `shipping`, which depends on
   * this context, so it is resolved lazily; a process that never wires shipping
   * has no labels to void.
   */
  private async voidLabels(
    input: ApplyOrderCancellationEffectsInput
  ): Promise<readonly OrderLabelVoidOutcome[]> {
    let voider: OrderLabelVoiderPort;
    try {
      voider = this.moduleRef.get<OrderLabelVoiderPort>(ORDER_LABEL_VOIDER_TOKEN, {
        strict: false,
      });
    } catch {
      this.logger.warn(
        `order_cancel_label_voider_not_wired order=${input.internalOrderId}: shipping is not wired into this process, so no label was voided`
      );
      return [];
    }
    try {
      const outcomes = await voider.voidLabelsForOrder(input.internalOrderId);
      for (const outcome of outcomes) {
        if (outcome.outcome === 'failed') {
          this.logger.warn(
            `order_cancel_label_not_voided order=${input.internalOrderId} shipment=${outcome.shipmentId}: ${outcome.detail ?? 'no detail'}`
          );
        }
      }
      return outcomes;
    } catch (error) {
      this.logger.error(
        `Failed to void the labels of cancelled order ${input.internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      return [];
    }
  }

  private async cancelWork(internalOrderId: string, cancelledAt: Date): Promise<string[]> {
    try {
      const result = await this.fulfillmentCancellation.cancelAllForOrder(
        internalOrderId,
        cancelledAt
      );
      return [...result.cancelledWorkIds];
    } catch (error) {
      this.logger.error(
        `Failed to cancel fulfilment work for cancelled order ${internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      return [];
    }
  }

  /**
   * Release the order's open hold: a cancelled order must not keep a "held" badge
   * or block anything. A service-placed hold is released AS that service (the only
   * service the policy admits); a user-placed one as the acting operator, or as
   * OpenLinker itself when the channel reported the cancel and there is no
   * operator (4b) - leaving it held would badge a cancelled order for ever.
   */
  private async releaseHolds(input: ApplyOrderCancellationEffectsInput): Promise<string[]> {
    try {
      const open = await this.holds.getOpenHold(input.internalOrderId);
      if (!open) return [];
      const releasedBy = open.placedByService
        ? ({ kind: 'service', service: open.placedByService } as const)
        : input.actorUserId
          ? ({ kind: 'user', userId: input.actorUserId } as const)
          : ({ kind: 'system', cause: 'order-cancelled' } as const);
      await this.holds.release({
        holdId: open.id,
        note: ORDER_CANCELLED_HOLD_RELEASE_NOTE,
        releasedBy,
      });
      return [open.id];
    } catch (error) {
      this.logger.error(
        `Failed to release the hold on cancelled order ${input.internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      return [];
    }
  }

  /**
   * Abandon the order's open discount proposals (B-31). A cancelled order is
   * credited in full by the cancel correction, so a pending discount refund or
   * discount correction left open would ask the operator to refund or correct the
   * same money a second time. Best-effort per proposal: the order IS cancelled by
   * now, and a proposal that stays open is visible and can be dismissed by hand.
   */
  private async abandonDiscountProposals(internalOrderId: string): Promise<void> {
    let open: OrderChange[];
    try {
      open = await this.changes.findOpenByOrder(internalOrderId);
    } catch (error) {
      this.logger.error(
        `Failed to list open discount proposals for cancelled order ${internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      return;
    }
    for (const change of open) {
      if (!DISCOUNT_PROPOSAL_KINDS.has(change.kind)) continue;
      try {
        await this.changes.abandon(change.id, DISCOUNT_PROPOSAL_ABANDON_REASON);
      } catch (error) {
        this.logger.error(
          `Failed to abandon discount proposal ${change.id} on cancelled order ${internalOrderId}`,
          error instanceof Error ? error.stack : undefined
        );
      }
    }
  }

  /**
   * Open the credit proposal for an issued invoice: every line to quantity zero.
   * Best-effort - the order IS cancelled by now, so a failure here is reported as
   * `proposal-failed` and the operator can still correct the invoice by hand.
   */
  private async proposeCreditCorrection(
    input: ApplyOrderCancellationEffectsInput,
    invoice: InvoiceRecord
  ): Promise<{
    proposal: OrderCancelCorrectionProposal | null;
    unavailable: OrderCancelCorrectionUnavailableReason | null;
  }> {
    if (!invoice.issuedLineSnapshot) {
      return { proposal: null, unavailable: 'no-line-snapshot' };
    }
    if (!invoice.providerInvoiceId || !invoice.providerInvoiceNumber || !invoice.issuedAt) {
      return { proposal: null, unavailable: 'not-fully-issued' };
    }
    // Numbered BEFORE filtering: `originalLineNumber` is the line's position on
    // the issued document, and dropping an already-zero line must not renumber
    // the rest.
    const lines = invoice.issuedLineSnapshot.lines
      .map((line, index) => ({
        originalLineNumber: index + 1,
        name: line.name,
        previousQuantity: line.quantity,
        newQuantity: 0,
      }))
      .filter((line) => line.previousQuantity > 0);
    if (lines.length === 0) {
      // Everything on the document was already credited; there is nothing to propose.
      return { proposal: null, unavailable: null };
    }
    const payload: OrderCancelCorrectionPayload = {
      invoiceRecordId: invoice.id,
      documentNumber: invoice.providerInvoiceNumber,
      currency: invoice.issuedLineSnapshot.currency,
      reason: `Order cancelled (${input.reason})`,
      lines,
    };
    try {
      const { change } = await this.changes.openOrReuse({
        internalOrderId: input.internalOrderId,
        kind: 'order.cancel_correction',
        targetRef: cancelCorrectionTargetRef(input.internalOrderId, invoice.id),
        payload: payload as unknown as Record<string, unknown>,
        requestedBy: input.actorUserId,
        requestedAt: new Date(),
      });
      return {
        proposal: {
          changeId: change.id,
          invoiceRecordId: invoice.id,
          documentNumber: invoice.providerInvoiceNumber,
          currency: payload.currency,
          lines,
        },
        unavailable: null,
      };
    } catch (error) {
      this.logger.error(
        `Failed to open the credit proposal for cancelled order ${input.internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      return { proposal: null, unavailable: 'proposal-failed' };
    }
  }
}
