/**
 * Order Cancellation Service (#3540, ADR-044, D37)
 *
 * The operator's "cancel this order" as an ADR-044 proposal: OpenLinker asks the
 * SOURCE to cancel, the source disposes, and OpenLinker confirms from what the
 * source answered. It orchestrates seams that already exist - the change record,
 * shipment voiding, the lifecycle relay, the stock-restore job, fulfilment work
 * cancellation, and the invoice correction - and owns only their ORDER.
 *
 * ## Why this lives in `apps/api` and not in `libs/core/src/orders`
 *
 * It needs `shipping`, and `shipping` already depends on `orders`
 * (`ShippingModule` imports `OrdersModule`), so an `orders -> shipping` edge would
 * be a module cycle. The host app's interface layer is where the repo composes
 * exactly this shape (`SourceFulfillmentStatusService`, the shortfall
 * projection), and everything it touches is reached through an `I*Service`.
 *
 * ## The order of effects is the design
 *
 * 1. Gates (all 409, nothing written): already cancelled, already shipped, fiscal
 *    receipt, unsettled invoice, work a holder accepted (soft, acknowledgeable).
 * 2. Open the `order.cancel_request` row. A row already open means a cancel is in
 *    flight (the TTL is ADR-044's mandated way out of a hung one).
 * 3. Void every outstanding label. A carrier that cannot void aborts the cancel
 *    BEFORE the channel hears anything: a cancelled order with a live label is the
 *    worse state, so the order is simply not cancelled.
 * 4. Tell the SOURCE first. Only when it accepts (or has no verb to refuse with)
 *    are the other participants told and the order marked cancelled. A refusal
 *    declines the row and leaves the order live.
 * 5. Apply: confirm, `markCancelled`, enqueue the stock restore, cancel the
 *    fulfilment work, and for an invoiced order open the credit proposal.
 *
 * A channel whose answer is UNKNOWN (the relay threw, or the adapter could not be
 * built) leaves the row open and reports `pending`: guessing "applied" would
 * cancel locally an order the channel still sells, and guessing "refused" would
 * discard a cancel it may have taken.
 *
 * ## What it deliberately does not do
 *
 * - The operator's `note` is NEVER relayed; only the closed reason code is. A free
 *   text field an operator wrote for colleagues must not become a message to a
 *   marketplace.
 * - It does not ask an accepting external holder to give the work back. That is a
 *   negotiation the holder may refuse (ADR-054); the soft gate is the operator
 *   acknowledging the work is cancelled underneath it.
 * - It never issues the credit note itself. Issuing a correction to a tax
 *   authority cannot be withdrawn, so the proposal waits for `confirmChange`.
 *
 * @module apps/api/src/orders/application/services
 * @implements {IOrderCancellationService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  type IFiscalRegistrationService,
} from '@openlinker/core/fiscalization';
import {
  FULFILLMENT_ORDER_CANCELLATION_SERVICE_TOKEN,
  type IFulfillmentOrderCancellationService,
} from '@openlinker/core/fulfillment';
import {
  buildOriginalDocumentFromIssuedRecord,
  classifyInvoiceFailure,
  INVOICE_SERVICE_TOKEN,
  type IInvoiceService,
  type InvoiceRecord,
} from '@openlinker/core/invoicing';
import {
  cancelCorrectionTargetRef,
  cancelRequestTargetRef,
  isOrderCancelReason,
  ORDER_CHANGE_SERVICE_TOKEN,
  ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  OPERATOR_ORDER_ORIGIN_ID,
  orderCancelReasonRequiresNote,
  orderStockRestoreDedupeKey,
  type IOrderChangeService,
  type IOrderLifecycleRelayService,
  type IOrderRecordService,
  type OrderChange,
  type OrderLifecycleRelayTargetResult,
  type OrderRecord,
} from '@openlinker/core/orders';
import {
  SHIPMENT_CANCELLATION_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  SHIPMENT_STATUS,
  type IShipmentCancellationService,
  type IShipmentQueryService,
  type Shipment,
} from '@openlinker/core/shipping';
import {
  SYNC_JOB_QUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  type SyncJobQueuePort,
  type SyncLockPort,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import {
  CancelCorrectionFailedError,
  OrderCancellationNoteRequiredError,
  OrderCancellationNotFoundError,
  OrderCancellationRefusedError,
} from '../errors/order-cancellation.errors';
import type { IOrderCancellationService } from '../interfaces/order-cancellation.service.interface';
import type {
  CancelCorrectionProposal,
  CancelCorrectionUnavailableReason,
  CancelOrderInput,
  CancelOrderResult,
  CancelParticipantEffect,
  CancelParticipantOutcome,
  ConfirmOrderChangeInput,
  ConfirmOrderChangeResult,
} from '../types/order-cancellation.types';

/**
 * The per-order lock only has to cover gate-read -> open of the request row; once
 * the row exists a peer's own `openOrReuse` sees it. Single-shot, no heartbeat -
 * the `order-refund-lock` shape.
 */
const ORDER_CANCEL_LOCK_TTL_MS = 30_000;

function orderCancelLockKey(internalOrderId: string): string {
  return `order:cancel:${internalOrderId}`;
}

/** Shipment statuses a carrier void can still act on. */
const VOIDABLE_SHIPMENT_STATUSES: readonly string[] = [
  SHIPMENT_STATUS.Draft,
  SHIPMENT_STATUS.Generated,
  SHIPMENT_STATUS.Dispatched,
];

/** Shipment statuses past which nothing can be voided: the parcel is with the carrier or the buyer. */
const LEFT_THE_BUILDING_STATUSES: readonly string[] = [
  SHIPMENT_STATUS.InTransit,
  SHIPMENT_STATUS.Delivered,
];

/** Shape persisted in `order.cancel_correction.payload` - no buyer data, product names only. */
interface CancelCorrectionPayload {
  readonly invoiceRecordId: string;
  readonly documentNumber: string | null;
  readonly currency: string;
  readonly reason: string;
  readonly lines: ReadonlyArray<{
    readonly originalLineNumber: number;
    readonly name: string;
    readonly previousQuantity: number;
    readonly newQuantity: number;
  }>;
}

@Injectable()
export class OrderCancellationService implements IOrderCancellationService {
  private readonly logger = new Logger(OrderCancellationService.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(ORDER_CHANGE_SERVICE_TOKEN)
    private readonly changes: IOrderChangeService,
    @Inject(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)
    private readonly relay: IOrderLifecycleRelayService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipmentQuery: IShipmentQueryService,
    @Inject(SHIPMENT_CANCELLATION_SERVICE_TOKEN)
    private readonly shipmentCancellation: IShipmentCancellationService,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    @Inject(FISCAL_REGISTRATION_SERVICE_TOKEN)
    private readonly fiscal: IFiscalRegistrationService,
    @Inject(FULFILLMENT_ORDER_CANCELLATION_SERVICE_TOKEN)
    private readonly fulfillmentCancellation: IFulfillmentOrderCancellationService,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort
  ) {}

  async cancelOrder(input: CancelOrderInput): Promise<CancelOrderResult> {
    if (!isOrderCancelReason(input.reason)) {
      // The DTO already refuses this; the service is a seam other callers (MCP,
      // bulk actions) will reach, so it does not trust its caller.
      throw new OrderCancellationNoteRequiredError();
    }
    if (orderCancelReasonRequiresNote(input.reason) && !input.note?.trim()) {
      throw new OrderCancellationNoteRequiredError();
    }

    const lockKey = orderCancelLockKey(input.internalOrderId);
    const token = await this.lock.acquire(lockKey, ORDER_CANCEL_LOCK_TTL_MS);
    if (token === null) {
      throw new OrderCancellationRefusedError(
        'ORDER_CANCEL_CONTENDED',
        'Another cancellation of this order is being processed. Wait a moment and check the order before trying again.'
      );
    }
    try {
      return await this.runCancel(input);
    } finally {
      await this.lock.release(lockKey, token);
    }
  }

  private async runCancel(input: CancelOrderInput): Promise<CancelOrderResult> {
    const order = await this.orderRecords.getOrderRecord(input.internalOrderId);
    if (!order) {
      throw new OrderCancellationNotFoundError(`Order not found: ${input.internalOrderId}`);
    }

    const shipments = await this.shipmentQuery.getOutboundByOrderId(input.internalOrderId);
    const latestInvoice = await this.invoices.getLatestInvoiceForOrder(input.internalOrderId);
    await this.assertCancellable(order, shipments, latestInvoice, input.acknowledgeAcceptedWork);

    const { change, opened } = await this.changes.openOrReuse({
      internalOrderId: input.internalOrderId,
      kind: 'order.cancel_request',
      targetRef: cancelRequestTargetRef(input.internalOrderId),
      payload: { reason: input.reason, note: input.note?.trim() ? input.note.trim() : null },
      requestedBy: input.actorUserId,
      requestedAt: new Date(),
    });
    if (!opened) {
      throw new OrderCancellationRefusedError(
        'ORDER_CANCEL_IN_FLIGHT',
        'A cancellation of this order is already waiting for the sales channel to answer. It stops waiting after a while; check the order and try again then.'
      );
    }

    const voidedShipmentIds = await this.voidLabels(shipments, change);

    const source = await this.tellSource(order, input.reason, change);
    if (source.verdict === 'pending') {
      return this.emptyResult('pending', change.id, source.participants, voidedShipmentIds);
    }
    if (source.verdict === 'refused') {
      await this.changes.decline(change.id, source.detail);
      const voidedNote =
        voidedShipmentIds.length > 0
          ? ` ${String(voidedShipmentIds.length)} shipping label(s) had already been voided and stay voided.`
          : '';
      throw new OrderCancellationRefusedError(
        'CHANNEL_REFUSED_CANCEL',
        `The sales channel refused the cancellation: ${source.detail}.${voidedNote}`
      );
    }

    const others = await this.tellOtherParticipants(order, input.reason);
    return this.applyCancellation(
      order,
      change,
      input,
      latestInvoice,
      [...source.participants, ...others.participants],
      others.relayFailed,
      voidedShipmentIds
    );
  }

  /** Every refusal that needs no write to decide. Order is the order the operator reads them in. */
  private async assertCancellable(
    order: OrderRecord,
    shipments: readonly Shipment[],
    latestInvoice: InvoiceRecord | null,
    acknowledgeAcceptedWork: boolean
  ): Promise<void> {
    if (order.cancelledAt !== null) {
      throw new OrderCancellationRefusedError(
        'ORDER_ALREADY_CANCELLED',
        'This order is already cancelled.'
      );
    }

    const hasLabelToVoid = shipments.some((s) => s.status === SHIPMENT_STATUS.Dispatched);
    const leftWithCarrier = shipments.some((s) => LEFT_THE_BUILDING_STATUSES.includes(s.status));
    const marketplaceSaysShipped =
      (order.fulfillmentState === 'dispatched' || order.fulfillmentState === 'delivered') &&
      !hasLabelToVoid;
    if (leftWithCarrier || marketplaceSaysShipped) {
      throw new OrderCancellationRefusedError(
        'ORDER_ALREADY_SHIPPED',
        'This order has already shipped, so it cannot be cancelled. Use the returns flow when the parcel comes back.'
      );
    }

    const registrations = await this.fiscal.getByOrderId(order.internalOrderId);
    if (registrations.some((r) => r.blocksFurtherRegistration)) {
      throw new OrderCancellationRefusedError(
        'ORDER_HAS_FISCAL_RECEIPT',
        'A fiscal receipt was registered for this order and OpenLinker cannot correct a receipt. Cancel the sale on the fiscal device or with the receipt provider first.'
      );
    }

    if (latestInvoice && latestInvoice.blocksIssuanceElsewhere && latestInvoice.status !== 'issued') {
      throw new OrderCancellationRefusedError(
        'INVOICE_NOT_SETTLED',
        'The invoice for this order has not finished issuing, so it cannot be corrected yet. Wait for it to settle, then cancel.'
      );
    }

    const works = await this.fulfillmentCancellation.summarizeForOrder(order.internalOrderId);
    const underway = works.some(
      (w) =>
        (w.status === 'in_progress' || w.requestStatus === 'accepted') &&
        w.status !== 'cancelled' &&
        w.status !== 'closed' &&
        w.status !== 'incomplete'
    );
    if (underway && !acknowledgeAcceptedWork) {
      throw new OrderCancellationRefusedError(
        'ORDER_WORK_ACCEPTED_NEEDS_ACK',
        'Someone has already accepted or started picking this order. Cancelling cancels that work underneath them. Confirm to go ahead.'
      );
    }
  }

  /**
   * Void every outstanding label. A carrier that cannot void aborts the cancel:
   * the request row is abandoned and nothing has been said to any channel.
   * Labels voided before a later one fails stay voided - a void cannot be undone -
   * and the refusal names how many.
   */
  private async voidLabels(shipments: readonly Shipment[], change: OrderChange): Promise<string[]> {
    const voided: string[] = [];
    for (const shipment of shipments) {
      if (!VOIDABLE_SHIPMENT_STATUSES.includes(shipment.status)) continue;
      try {
        await this.shipmentCancellation.cancel(shipment.id);
        voided.push(shipment.id);
      } catch (error) {
        await this.changes.abandon(change.id);
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `order_cancel_label_not_voidable order=${change.internalOrderId} shipment=${shipment.id}: ${reason}`
        );
        const alreadyVoided =
          voided.length > 0
            ? ` ${String(voided.length)} other label(s) were already voided and stay voided.`
            : '';
        throw new OrderCancellationRefusedError(
          'LABEL_NOT_VOIDABLE',
          `The shipping label for this order could not be voided, so the order was not cancelled: ${reason}.${alreadyVoided}`
        );
      }
    }
    return voided;
  }

  private async tellSource(
    order: OrderRecord,
    reason: string,
    change: OrderChange
  ): Promise<
    | { verdict: 'applied'; participants: CancelParticipantOutcome[] }
    | { verdict: 'pending'; participants: CancelParticipantOutcome[] }
    | { verdict: 'refused'; participants: CancelParticipantOutcome[]; detail: string }
  > {
    let targets: readonly OrderLifecycleRelayTargetResult[];
    try {
      const result = await this.relay.relay({
        internalOrderId: order.internalOrderId,
        originConnectionId: OPERATOR_ORDER_ORIGIN_ID,
        onlyConnectionIds: [order.sourceConnectionId],
        event: { type: 'cancelled', reason },
      });
      targets = result.targets;
    } catch (error) {
      this.logger.error(
        `order_cancel_relay_threw order=${order.internalOrderId} change=${change.id}; leaving the request open`,
        error instanceof Error ? error.stack : undefined
      );
      return { verdict: 'pending', participants: [] };
    }

    const sourceResult = targets.find((t) => t.connectionId === order.sourceConnectionId);
    if (!sourceResult) {
      // No order mapping on the source: there is nobody to ask, which is the
      // same fact as a source with no cancel verb.
      return { verdict: 'applied', participants: [] };
    }
    const participant = this.toParticipant(sourceResult, 'source');

    if (sourceResult.outcome === 'rejected') {
      return {
        verdict: 'refused',
        participants: [participant],
        detail: sourceResult.detail ?? 'no reason given',
      };
    }
    if (
      sourceResult.outcome === 'unsupported' &&
      sourceResult.unsupportedReason === 'adapter-unresolved'
    ) {
      return { verdict: 'pending', participants: [participant] };
    }
    return { verdict: 'applied', participants: [participant] };
  }

  private async tellOtherParticipants(
    order: OrderRecord,
    reason: string
  ): Promise<{ participants: CancelParticipantOutcome[]; relayFailed: boolean }> {
    try {
      const result = await this.relay.relay({
        internalOrderId: order.internalOrderId,
        originConnectionId: OPERATOR_ORDER_ORIGIN_ID,
        authoredByConnectionId: order.sourceConnectionId,
        event: { type: 'cancelled', reason },
      });
      return {
        participants: result.targets.map((t) => this.toParticipant(t, 'destination')),
        relayFailed: false,
      };
    } catch (error) {
      // The source already accepted, so the order IS cancelled; failing here would
      // strand it half-applied. Report that the rest were not told instead.
      this.logger.error(
        `order_cancel_destination_relay_threw order=${order.internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      return { participants: [], relayFailed: true };
    }
  }

  private toParticipant(
    target: OrderLifecycleRelayTargetResult,
    role: 'source' | 'destination'
  ): CancelParticipantOutcome {
    return {
      connectionId: target.connectionId,
      role,
      effect: this.effectOf(target),
      detail: target.detail ?? null,
    };
  }

  private effectOf(target: OrderLifecycleRelayTargetResult): CancelParticipantEffect {
    switch (target.outcome) {
      case 'applied':
        return target.scope === 'stock-only' ? 'stock-restored-only' : 'notified';
      case 'rejected':
        return 'refused';
      case 'unsupported':
        return target.unsupportedReason === 'adapter-unresolved' ? 'unreachable' : 'not-supported';
    }
  }

  private async applyCancellation(
    order: OrderRecord,
    change: OrderChange,
    input: CancelOrderInput,
    latestInvoice: InvoiceRecord | null,
    participants: readonly CancelParticipantOutcome[],
    otherParticipantsRelayFailed: boolean,
    voidedShipmentIds: readonly string[]
  ): Promise<CancelOrderResult> {
    const confirmed = await this.changes.confirm(change.id, input.actorUserId);
    const claimed = confirmed ? await this.changes.claimApplied(change.id) : false;
    if (!claimed) {
      // A peer applied it between our gate and here; its side effects are theirs.
      this.logger.warn(`order_cancel_apply_lost_race order=${order.internalOrderId} change=${change.id}`);
    }

    const cancelledAt = new Date();
    await this.orderRecords.markCancelled(order.internalOrderId, cancelledAt);

    const stockRestoreEnqueued = claimed ? await this.enqueueStockRestore(order) : false;
    const cancelledWorkIds = claimed ? await this.cancelWork(order.internalOrderId, cancelledAt) : [];

    let correctionProposal: CancelCorrectionProposal | null = null;
    let correctionUnavailableReason: CancelCorrectionUnavailableReason | null = null;
    if (claimed && latestInvoice && latestInvoice.status === 'issued') {
      const proposed = await this.proposeCreditCorrection(order, latestInvoice, input);
      correctionProposal = proposed.proposal;
      correctionUnavailableReason = proposed.unavailable;
    }

    return {
      status: 'cancelled',
      changeId: change.id,
      cancelledAt,
      participants,
      otherParticipantsRelayFailed,
      voidedShipmentIds,
      cancelledWorkIds,
      stockRestoreEnqueued,
      correctionProposal,
      correctionUnavailableReason,
    };
  }

  private async enqueueStockRestore(order: OrderRecord): Promise<boolean> {
    try {
      await this.jobQueue.enqueue({
        type: 'marketplace.offer.stockRestore',
        connectionId: order.sourceConnectionId,
        payload: { schemaVersion: 1, internalOrderId: order.internalOrderId },
        options: {
          dedupeKey: orderStockRestoreDedupeKey(order.sourceConnectionId, order.internalOrderId),
        },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to enqueue stock-restore for operator-cancelled order ${order.internalOrderId}; stock will NOT be auto-restored`,
        error instanceof Error ? error.stack : undefined
      );
      return false;
    }
  }

  private async cancelWork(internalOrderId: string, cancelledAt: Date): Promise<string[]> {
    try {
      const result = await this.fulfillmentCancellation.cancelAllForOrder(internalOrderId, cancelledAt);
      return [...result.cancelledWorkIds];
    } catch (error) {
      this.logger.error(
        `Failed to cancel fulfilment work for operator-cancelled order ${internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      return [];
    }
  }

  /**
   * Open the credit proposal for an issued invoice: every line to quantity zero.
   * Best-effort - the order IS cancelled by now, so a failure here is reported as
   * `proposal-failed` and the operator can still correct the invoice by hand.
   */
  private async proposeCreditCorrection(
    order: OrderRecord,
    invoice: InvoiceRecord,
    input: CancelOrderInput
  ): Promise<{
    proposal: CancelCorrectionProposal | null;
    unavailable: CancelCorrectionUnavailableReason | null;
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
    const payload: CancelCorrectionPayload = {
      invoiceRecordId: invoice.id,
      documentNumber: invoice.providerInvoiceNumber,
      currency: invoice.issuedLineSnapshot.currency,
      reason: `Order cancelled (${input.reason})`,
      lines,
    };
    try {
      const { change } = await this.changes.openOrReuse({
        internalOrderId: order.internalOrderId,
        kind: 'order.cancel_correction',
        targetRef: cancelCorrectionTargetRef(order.internalOrderId, invoice.id),
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
        `Failed to open the credit proposal for cancelled order ${order.internalOrderId}`,
        error instanceof Error ? error.stack : undefined
      );
      return { proposal: null, unavailable: 'proposal-failed' };
    }
  }

  async confirmChange(input: ConfirmOrderChangeInput): Promise<ConfirmOrderChangeResult> {
    const change = await this.changes.findById(input.changeId);
    // Ownership BEFORE any write: a change id belonging to another order is
    // indistinguishable from an absent one, and neither may be probed.
    if (!change || change.internalOrderId !== input.internalOrderId) {
      throw new OrderCancellationNotFoundError(
        `Change not found on order ${input.internalOrderId}: ${input.changeId}`
      );
    }

    switch (change.kind) {
      case 'order.cancel_correction':
        return this.confirmCancelCorrection(change, input);
      case 'order.cancel_request':
      case 'return.decline':
      case 'return.authorize':
      case 'return.invoice_correction':
        throw new OrderCancellationRefusedError(
          'CHANGE_KIND_NOT_CONFIRMABLE',
          `A change of kind ${change.kind} is not confirmed here.`
        );
    }
  }

  private async confirmCancelCorrection(
    change: OrderChange,
    input: ConfirmOrderChangeInput
  ): Promise<ConfirmOrderChangeResult> {
    switch (change.status) {
      case 'confirmed':
        throw new OrderCancellationRefusedError(
          'CHANGE_ALREADY_CONFIRMED',
          'This correction was already confirmed.'
        );
      case 'expired':
        throw new OrderCancellationRefusedError(
          'CHANGE_EXPIRED',
          'This correction proposal expired. Correct the invoice from the invoice page instead.'
        );
      case 'declined':
      case 'canceled':
        throw new OrderCancellationRefusedError(
          'CHANGE_NOT_OPEN',
          `This correction proposal is ${change.status} and can no longer be confirmed.`
        );
      case 'pending':
      case 'requested':
        break;
    }

    const payload = this.readCorrectionPayload(change);
    const invoice = await this.invoices.getInvoiceById(payload.invoiceRecordId);
    if (
      !invoice ||
      invoice.orderId !== input.internalOrderId ||
      invoice.status !== 'issued' ||
      !invoice.providerInvoiceId ||
      !invoice.issuedLineSnapshot
    ) {
      throw new OrderCancellationRefusedError(
        'CHANGE_NOT_OPEN',
        'The invoice this proposal corrects is no longer in a state that can be corrected.'
      );
    }

    let issued: InvoiceRecord;
    try {
      issued = await this.invoices.issueCorrection({
        connectionId: invoice.connectionId,
        orderId: invoice.orderId,
        originalProviderInvoiceId: invoice.providerInvoiceId,
        documentType: 'corrected',
        reason: payload.reason,
        lines: payload.lines.map((line) => ({
          originalLineNumber: line.originalLineNumber,
          newQuantity: line.newQuantity,
        })),
        // Derived from the change id, never wall-clock: a retried confirm re-sends
        // the SAME key, so the provider sees one correction however many clicks.
        idempotencyKey: `cancel-correction:${change.id}`,
        originalDocument: buildOriginalDocumentFromIssuedRecord(invoice, invoice.issuedLineSnapshot),
      });
    } catch (error) {
      const classification = classifyInvoiceFailure(error);
      this.logger.warn(
        `order_cancel_correction_failed order=${input.internalOrderId} change=${change.id} code=${classification.failureCode}`
      );
      // The row stays open: the operator can retry, and the idempotency key keeps a
      // retry from issuing twice.
      throw new CancelCorrectionFailedError(classification.failureReason, classification.failureCode);
    }

    if (issued.status !== 'issued') {
      throw new OrderCancellationRefusedError(
        issued.isLeaseLive(new Date()) ? 'CORRECTION_IN_PROGRESS' : 'CORRECTION_NEEDS_RECONCILIATION',
        issued.isLeaseLive(new Date())
          ? 'The correction is already being issued by another attempt. Retry once it settles.'
          : 'An earlier attempt at this correction ended without knowing whether the provider created a document. It needs reconciling rather than retrying.'
      );
    }

    await this.changes.confirm(change.id, input.actorUserId);
    await this.changes.claimApplied(change.id);

    return {
      changeId: change.id,
      kind: change.kind,
      status: 'confirmed',
      invoiceRecordId: issued.id,
      invoiceStatus: issued.status,
      documentNumber: issued.providerInvoiceNumber,
    };
  }

  private readCorrectionPayload(change: OrderChange): CancelCorrectionPayload {
    const raw = change.payload;
    const lines = raw && Array.isArray(raw['lines']) ? (raw['lines'] as unknown[]) : null;
    if (
      !raw ||
      typeof raw['invoiceRecordId'] !== 'string' ||
      typeof raw['reason'] !== 'string' ||
      !lines
    ) {
      throw new OrderCancellationRefusedError(
        'CHANGE_NOT_OPEN',
        'This correction proposal is unreadable and cannot be confirmed.'
      );
    }
    return raw as unknown as CancelCorrectionPayload;
  }

  private emptyResult(
    status: 'pending',
    changeId: string,
    participants: readonly CancelParticipantOutcome[],
    voidedShipmentIds: readonly string[]
  ): CancelOrderResult {
    return {
      status,
      changeId,
      cancelledAt: null,
      participants,
      otherParticipantsRelayFailed: false,
      voidedShipmentIds,
      cancelledWorkIds: [],
      stockRestoreEnqueued: false,
      correctionProposal: null,
      correctionUnavailableReason: null,
    };
  }
}
