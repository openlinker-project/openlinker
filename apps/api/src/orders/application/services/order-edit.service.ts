/**
 * Order Edit Service (#3542, D9, ADR-044)
 *
 * The operator's post-import edit of an order: shipping address, line
 * quantities, delivery method. With the OMS on, OpenLinker owns the order, so an
 * edit is an OpenLinker-side amendment: an `order_changes` row confirmed the
 * instant it is written (the `return.authorize` shape - the row is the audit
 * record of the act, not a request a channel answers). It never puts the order in
 * the `amending` phase, and it writes nothing back to a channel: none of the four
 * adapters supports any of these edits, so the channel keeps its original and the
 * order timeline says so.
 *
 * ## Why this lives in `apps/api` and not in `libs/core/src/orders`
 *
 * It needs `shipping`, which already depends on `orders` (a module cycle), and
 * `fulfillment` / `inventory`, exactly the composition `OrderCancellationService`
 * makes for the same reason.
 *
 * ## The order of effects is the design
 *
 * 1. Gates (all 409, nothing written).
 * 2. Open the change row.
 * 3. Write the overlay (one atomic UPDATE, guarded on the overlay's `rev`).
 *    This is the point of no return: from here the order IS edited, and every
 *    reader sees it.
 * 4. Lines only: narrow the work object, lower the reservation, give the stock
 *    back. Each is idempotent and keyed on this change, so a retried edit finishes
 *    what a crash left undone and never does anything twice.
 * 5. Confirm the row.
 *
 * ## Deliberate refusals
 *
 * - `EDIT_AFTER_HANDOFF` is unreachable today: the only holder that exists in the
 *   tree is the in-process OL executor, which reads the order when the parcel is
 *   packed and so sees the edit. It exists because the day an external 3PL holds
 *   work, the ship-to it was sent cannot be changed (the executor port has no
 *   such verb), and quietly editing OpenLinker's copy would leave the warehouse
 *   shipping to the old address.
 * - An address edit is refused under `OL_STORE_PII=false`: the new address would
 *   be written to the database in the clear, which is exactly what that setting
 *   says not to keep.
 * - A quantity edit creates no refund intent. A lowered total on a paid order is
 *   shown (`totals.difference`); only the discount money event (#3543) opens one.
 *
 * ## The discount (#3543, D10, ADR-014 amendment)
 *
 * `editDiscount` is the same shape - open, overlay, confirm in one breath - plus
 * what the discount means for money, decided by what the buyer has already done:
 *
 * - `paid`   - `paymentStatus === 'paid'`. A refund intent for the difference is
 *   opened as an `order.discount_refund` change (checked against the #3289 refund
 *   ceiling at creation) and payment stays "Paid" until the seller confirms they
 *   refunded on the channel (ADR-056: OpenLinker executes no refund).
 * - `cod`    - `paymentStatus === 'cod'`, or the neutral payment method is
 *   cash-on-delivery and the order is not paid. The amount to collect and the COD
 *   amount a label not yet bought uses are the discounted figures. A bought label
 *   carries the old COD amount, so it refuses (`LABEL_ALREADY_BOUGHT`).
 * - `unpaid` - `paymentStatus === 'awaiting'`: the amount to collect falls.
 * - `unknown` - no payment status, or `refunded`. Treated like `unpaid` for
 *   documents and never as a refund intent: refunding on a guess moves money.
 *
 * Whatever the branch, documents issued afterwards read the discounted prices
 * (they read the effective view), and an ALREADY issued invoice gets an
 * `order.discount_correction` proposal the operator confirms - a fiscal receipt
 * cannot be corrected (ADR-042), so on a paid order that refuses
 * (`ORDER_HAS_FISCAL_RECEIPT`) and on an unpaid one the discount stands and the
 * proposal is reported unavailable.
 *
 * @module apps/api/src/orders/application/services
 * @implements {IOrderEditService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  type IFiscalRegistrationService,
} from '@openlinker/core/fiscalization';
import {
  FULFILLMENT_ORDER_EDIT_SERVICE_TOKEN,
  type IFulfillmentOrderEditService,
  type OrderWorkEditAssessment,
} from '@openlinker/core/fulfillment';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  INVENTORY_SALE_REVERSAL_SERVICE_TOKEN,
  RESERVATION_SERVICE_TOKEN,
  type IInventorySaleReversalService,
  type IReservationService,
} from '@openlinker/core/inventory';
import {
  INVOICE_SERVICE_TOKEN,
  type IInvoiceService,
  type InvoiceRecord,
} from '@openlinker/core/invoicing';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';
import {
  addressEditTargetRef,
  applyOrderEditsToSnapshot,
  decideRefundCeiling,
  decimalPlaces,
  deliveryMethodEditTargetRef,
  discountCorrectionTargetRef,
  discountedUnitPriceGross,
  discountEditTargetRef,
  discountRefundTargetRef,
  effectiveDiscountAmount,
  effectiveLineQuantity,
  evaluateRefundCeiling,
  goodsGrossValue,
  isDecimalAmountText,
  lineQuantityEditTargetRef,
  OPEN_ORDER_CHANGE_STATUSES,
  ORDER_CHANGE_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  ORDER_REFUND_SERVICE_TOKEN,
  OrderAmendmentRequestKindValues,
  OrderOperatorEditKindValues,
  readLineEditTreatments,
  resolveTotalUnitPrice,
  planOrderDiscount,
  type Address,
  type ApplyOrderEditInput,
  type DiscountableLine,
  type IOrderChangeService,
  type IOrderRecordService,
  type IOrderRefundService,
  type OrderDiscountEdit,
  type OrderEdits,
  type OrderOperatorEditKind,
  type OrderRecord,
  type PlannedOrderDiscount,
  type RefundCeilingVerdict,
} from '@openlinker/core/orders';
import { minorUnitExponentFor } from '@openlinker/core/sales-documents';
import { OMS_ADAPTER_KEY } from '@openlinker/oms';
import { SHIPMENT_QUERY_SERVICE_TOKEN, SHIPMENT_STATUS, type IShipmentQueryService, type Shipment } from '@openlinker/core/shipping';
import { SYNC_LOCK_TOKEN, type SyncLockPort } from '@openlinker/core/sync';
import { getEnvBoolean, hashAddress, normalizeAddress } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';

import {
  CONNECTION_SERVICE_TOKEN,
  type IConnectionService,
} from '../../../integrations/application/interfaces/connection.service.interface';
import {
  OrderEditInvalidError,
  OrderEditNotFoundError,
  OrderEditRefusedError,
} from '../errors/order-edit.errors';
import type { IOrderEditService } from '../interfaces/order-edit.service.interface';
import type {
  DiscountCorrectionLine,
  DiscountCorrectionProposal,
  DiscountCorrectionUnavailableReason,
  DiscountPaymentBranch,
  DiscountRefundIntent,
  EditOrderAddressInput,
  EditOrderDeliveryMethodInput,
  EditOrderDiscountInput,
  EditOrderLinesInput,
  OrderDiscountOutcome,
  OrderEditLineStock,
  OrderEditResult,
  OrderEditsView,
} from '../types/order-edit.types';
import {
  buildDiscountProposals,
  buildOrderEditHistory,
  buildOrderEditsView,
} from './order-edits-view';

/**
 * Covers read-gates -> overlay write. Once the overlay is written a peer's own
 * gates see it, and the follow-up effects are idempotent, so no longer is needed.
 */
const ORDER_EDIT_LOCK_TTL_MS = 30_000;

function orderEditLockKey(internalOrderId: string): string {
  return `order:edit:${internalOrderId}`;
}

/** A label exists (bought) but the parcel has not left: the address is baked into it. */
const LABEL_BOUGHT_STATUSES: readonly string[] = [SHIPMENT_STATUS.Generated, SHIPMENT_STATUS.Dispatched];

/** Past these the parcel is with the carrier or the buyer. */
const LEFT_THE_BUILDING_STATUSES: readonly string[] = [
  SHIPMENT_STATUS.InTransit,
  SHIPMENT_STATUS.Delivered,
];

/** What a kind-specific step decided: the overlay patch, the change payload and any follow-up. */
interface PreparedEdit {
  readonly kind: OrderOperatorEditKind;
  readonly targetRef: string;
  readonly payload: Record<string, unknown>;
  readonly patch: Omit<ApplyOrderEditInput, 'internalOrderId' | 'expectedRev'>;
  /** Discount only: what the money event amounts to, decided before anything is written. */
  readonly discountPlan?: DiscountPlan;
  /**
   * Discount only: the requested amount is already the stored one, so there is
   * nothing to write - only proposals a failed earlier attempt left missing.
   */
  readonly ensureOnly?: boolean;
  /** Lines only: what to do to work, holds and stock once the overlay is written. */
  readonly loweredLines: ReadonlyArray<{
    readonly orderLineId: string;
    readonly newQuantity: number;
    readonly removedUnits: number;
  }>;
  /**
   * Crash recovery (B-30): the overlay already holds this edit and its change row
   * is still open, so only the idempotent follow-ups and the confirm are left.
   */
  readonly recoverChangeId?: string;
}

/** A document line the discount would correct, before the change row exists. */
interface PlannedCorrection {
  readonly invoice: InvoiceRecord;
  readonly lines: readonly DiscountCorrectionLine[];
}

/** Everything about a discount that is decided before the overlay is written. */
interface DiscountPlan {
  readonly paymentBranch: DiscountPaymentBranch;
  readonly currency: string;
  /** The resulting absolute discount; `0` removes it. */
  readonly amount: number;
  /** The refund intent to open, when the order is paid and the difference is positive. */
  readonly refund: {
    readonly amount: string;
    readonly verdict: RefundCeilingVerdict;
  } | null;
  readonly correction: PlannedCorrection | null;
  readonly correctionUnavailableReason: DiscountCorrectionUnavailableReason | null;
}

/** A channel line with the identity the document matching needs. */
interface RawOrderLine extends DiscountableLine {
  readonly productId: string | null;
  readonly name: string | null;
}

@Injectable()
export class OrderEditService implements IOrderEditService {
  private readonly logger = new Logger(OrderEditService.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(ORDER_CHANGE_SERVICE_TOKEN)
    private readonly changes: IOrderChangeService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipmentQuery: IShipmentQueryService,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    @Inject(FISCAL_REGISTRATION_SERVICE_TOKEN)
    private readonly fiscal: IFiscalRegistrationService,
    @Inject(FULFILLMENT_ORDER_EDIT_SERVICE_TOKEN)
    private readonly fulfillmentEdit: IFulfillmentOrderEditService,
    @Inject(RESERVATION_SERVICE_TOKEN)
    private readonly reservations: IReservationService,
    @Inject(INVENTORY_SALE_REVERSAL_SERVICE_TOKEN)
    private readonly saleReversal: IInventorySaleReversalService,
    @Inject(CONNECTION_SERVICE_TOKEN)
    private readonly connections: IConnectionService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly lock: SyncLockPort,
    @Inject(ORDER_REFUND_SERVICE_TOKEN)
    private readonly refunds: IOrderRefundService
  ) {}

  editAddress(input: EditOrderAddressInput): Promise<OrderEditResult> {
    return this.run(input, async (record, assessment, shipments) => {
      if (!getEnvBoolean('OL_STORE_PII', true)) {
        throw new OrderEditRefusedError(
          'ADDRESS_EDIT_NEEDS_PII_STORAGE',
          'OpenLinker is set not to store buyer addresses, so a new address cannot be kept. Change the address on the sales channel, or turn address storage on.'
        );
      }
      this.assertLabelNotBought(shipments);
      await this.assertNotHandedOff(assessment);

      const current = this.readShippingAddress(record);
      const next: Address = {
        ...input.address,
        ...(current?.taxId !== undefined && input.address.taxId === undefined
          ? { taxId: current.taxId }
          : {}),
      };
      if (current !== undefined && this.sameAddress(current, next)) {
        throw new OrderEditRefusedError('NOTHING_CHANGED', 'The address is already what you entered.');
      }

      const now = new Date().toISOString();
      return {
        kind: 'order.address_change',
        targetRef: addressEditTargetRef(record.internalOrderId),
        // Field NAMES only: the change row is an audit trail and must not hold the address.
        payload: { fields: this.changedAddressFields(current, next) },
        patch: {
          address: {
            changeId: '',
            editedAt: now,
            editedBy: input.actorUserId,
            shipping: next,
            hash: this.hashShipping(next),
          },
        },
        loweredLines: [],
      };
    });
  }

  editLines(input: EditOrderLinesInput): Promise<OrderEditResult> {
    return this.run(input, async (record, assessment, _shipments, latestInvoiceBlocks) => {
      const seen = new Set<string>();
      for (const line of input.lines) {
        if (seen.has(line.orderLineId)) {
          throw new OrderEditInvalidError(`Order line ${line.orderLineId} appears more than once.`);
        }
        seen.add(line.orderLineId);
        if (!Number.isInteger(line.quantity) || line.quantity < 0) {
          throw new OrderEditInvalidError(
            `The quantity of line ${line.orderLineId} must be a whole number, zero or more.`
          );
        }
      }
      if (input.lines.length === 0) {
        throw new OrderEditInvalidError('Name at least one line to lower.');
      }
      if (latestInvoiceBlocks) {
        throw new OrderEditRefusedError(
          'SALES_DOCUMENT_ISSUED',
          'A sales document was already issued for this order, so its quantities cannot change. Correct the document from the invoice panel instead.'
        );
      }

      const channelItems = this.readChannelItems(record);
      const channelPrices = this.readChannelItemPrices(record);
      const treatments = readLineEditTreatments(record.channelSnapshot.totals);
      const currentEdits = record.orderEdits;
      const lowered: Array<{ orderLineId: string; newQuantity: number; removedUnits: number }> = [];
      const patchLines: Record<string, { changeId: string; editedAt: string; editedBy: string | null; quantity: number }> = {};
      const now = new Date().toISOString();

      for (const line of input.lines) {
        const channelQuantity = channelItems.get(line.orderLineId);
        if (channelQuantity === undefined) {
          throw new OrderEditNotFoundError(`Order line not found: ${line.orderLineId}`);
        }
        const effective = effectiveLineQuantity(channelQuantity, currentEdits?.lines?.[line.orderLineId]);
        if (line.quantity > effective) {
          throw new OrderEditRefusedError(
            'QUANTITY_ONLY_DECREASES',
            `Line ${line.orderLineId} can only be lowered (it is ${String(effective)}). Raising a quantity is a new sale, which OpenLinker will not charge.`
          );
        }
        if (line.quantity === effective) continue;
        // B-38: restating a GROSS total by a NET price would be wrong money, so a
        // line whose gross unit price cannot be known is refused, never guessed.
        const priced = channelPrices.get(line.orderLineId);
        if (priced === undefined || resolveTotalUnitPrice(priced, treatments) === null) {
          throw new OrderEditRefusedError(
            'LINE_PRICE_NOT_RESOLVABLE',
            `Line ${line.orderLineId} is priced without tax and the channel did not report its price with tax, so the new total cannot be worked out. Change the quantity on the sales channel, or cancel and re-enter the order.`
          );
        }
        const fulfilled = assessment.fulfilledByLine[line.orderLineId] ?? 0;
        if (line.quantity < fulfilled) {
          throw new OrderEditRefusedError(
            'QUANTITY_BELOW_FULFILLED',
            `${String(fulfilled)} unit(s) of line ${line.orderLineId} are already picked, so it cannot go below that.`
          );
        }
        lowered.push({
          orderLineId: line.orderLineId,
          newQuantity: line.quantity,
          removedUnits: effective - line.quantity,
        });
        patchLines[line.orderLineId] = {
          changeId: '',
          editedAt: now,
          editedBy: input.actorUserId,
          quantity: line.quantity,
        };
      }
      if (lowered.length === 0) {
        const recovery = await this.findInterruptedLineEdit(record, input.lines);
        if (recovery !== null) return recovery;
        throw new OrderEditRefusedError('NOTHING_CHANGED', 'No quantity is lower than it already is.');
      }

      const stillOpen = [...channelItems.entries()].some(([lineId, channelQuantity]) => {
        const next = patchLines[lineId]?.quantity ?? effectiveLineQuantity(channelQuantity, currentEdits?.lines?.[lineId]);
        return next > 0;
      });
      if (!stillOpen) {
        throw new OrderEditRefusedError(
          'ORDER_WOULD_BE_EMPTY',
          'That would remove every line. Cancel the order instead.'
        );
      }
      this.assertDiscountStillFits(record, patchLines);
      if (!input.acknowledgeAcceptedWork && (await this.isUnderway(assessment))) {
        throw new OrderEditRefusedError(
          'ORDER_WORK_ACCEPTED_NEEDS_ACK',
          'Someone has already accepted or started picking this order. Lowering a quantity changes their work underneath them. Confirm to go ahead.'
        );
      }

      return {
        kind: 'order.line_quantity_change',
        targetRef: lineQuantityEditTargetRef(record.internalOrderId),
        payload: {
          lines: lowered.map((line) => ({
            orderLineId: line.orderLineId,
            to: line.newQuantity,
            removed: line.removedUnits,
          })),
        },
        patch: { lines: patchLines },
        loweredLines: lowered,
      };
    }, true);
  }

  editDeliveryMethod(input: EditOrderDeliveryMethodInput): Promise<OrderEditResult> {
    return this.run(input, async (record, assessment, shipments) => {
      if (input.methodId.trim() === '') {
        throw new OrderEditInvalidError('A delivery method is required.');
      }
      this.assertLabelNotBought(shipments);
      await this.assertNotHandedOff(assessment);

      const currentId = record.sourceDeliveryMethodId;
      const currentPickup = this.readPickupId(record);
      const nextPickup = input.pickupPoint?.id ?? null;
      // A new name alone is a change: the label and the documents print it.
      const nameChanged = input.methodName !== null && input.methodName !== record.sourceDeliveryMethodName;
      const pickupNameChanged =
        input.pickupPoint?.name !== undefined && input.pickupPoint.name !== this.readPickupName(record);
      if (
        currentId === input.methodId &&
        currentPickup === nextPickup &&
        !nameChanged &&
        !pickupNameChanged
      ) {
        throw new OrderEditRefusedError('NOTHING_CHANGED', 'The order already has that delivery method.');
      }
      const now = new Date().toISOString();
      return {
        kind: 'order.delivery_method_change',
        targetRef: deliveryMethodEditTargetRef(record.internalOrderId),
        payload: {
          from: { methodId: currentId, pickupPointId: currentPickup },
          to: { methodId: input.methodId, pickupPointId: nextPickup },
        },
        patch: {
          deliveryMethod: {
            changeId: '',
            editedAt: now,
            editedBy: input.actorUserId,
            methodId: input.methodId,
            methodName: input.methodName,
            pickupPoint: input.pickupPoint,
          },
        },
        loweredLines: [],
      };
    });
  }

  editDiscount(input: EditOrderDiscountInput): Promise<OrderEditResult> {
    return this.run(input, (record, _assessment, shipments) =>
      this.prepareDiscount(input, record, shipments)
    );
  }

  async getEditsView(record: OrderRecord): Promise<OrderEditsView | null> {
    const edits = record.orderEdits;
    if (edits === null) return null;
    const unmatched = record.unmatchedLineEdits;
    if (unmatched.length > 0) {
      this.logger.warn(
        `Order ${record.internalOrderId} carries ${String(unmatched.length)} line edit(s) whose line id the channel no longer reports ` +
          `(${unmatched.map((entry) => entry.orderLineId).join(', ')}); they are kept but not applied`
      );
    }
    const [changes, open] = await Promise.all([
      this.changes.findByOrderAndKinds(record.internalOrderId, OrderOperatorEditKindValues),
      this.changes.findOpenByOrder(record.internalOrderId),
    ]);
    return buildOrderEditsView(
      record.channelSnapshot,
      edits,
      buildOrderEditHistory(changes, record.sourceConnectionId),
      buildDiscountProposals(open)
    );
  }

  // ---------------------------------------------------------------------------

  private async run(
    input: { internalOrderId: string; actorUserId: string | null; dryRun: boolean },
    prepare: (
      record: OrderRecord,
      assessment: OrderWorkEditAssessment,
      shipments: readonly Shipment[],
      documentIssued: boolean
    ) => Promise<PreparedEdit>,
    checksDocuments = false
  ): Promise<OrderEditResult> {
    if (input.dryRun) {
      return this.runLocked(input, prepare, checksDocuments);
    }
    const key = orderEditLockKey(input.internalOrderId);
    const token = await this.lock.acquire(key, ORDER_EDIT_LOCK_TTL_MS);
    if (token === null) {
      throw new OrderEditRefusedError(
        'ORDER_EDIT_CONTENDED',
        'Another edit of this order is being processed. Wait a moment and check the order before trying again.'
      );
    }
    try {
      return await this.runLocked(input, prepare, checksDocuments);
    } finally {
      await this.lock.release(key, token);
    }
  }

  private async runLocked(
    input: { internalOrderId: string; actorUserId: string | null; dryRun: boolean },
    prepare: (
      record: OrderRecord,
      assessment: OrderWorkEditAssessment,
      shipments: readonly Shipment[],
      documentIssued: boolean
    ) => Promise<PreparedEdit>,
    checksDocuments: boolean
  ): Promise<OrderEditResult> {
    const record = await this.orderRecords.getOrderRecord(input.internalOrderId);
    if (!record) {
      throw new OrderEditNotFoundError(`Order not found: ${input.internalOrderId}`);
    }

    const shipments = await this.shipmentQuery.getOutboundByOrderId(input.internalOrderId);
    const assessment = await this.fulfillmentEdit.assessForEdit(input.internalOrderId);
    await this.assertEditable(record, shipments, assessment);
    const documentIssued = checksDocuments ? await this.hasIssuedDocument(record) : false;

    const prepared = await prepare(record, assessment, shipments, documentIssued);
    const expectedRev = record.orderEdits?.rev ?? 0;

    if (input.dryRun) {
      const hypothetical = this.hypotheticalEdits(record, prepared);
      return {
        dryRun: true,
        changeId: null,
        view: await this.viewAfter(record, hypothetical),
        stock: [],
        ...(prepared.discountPlan !== undefined && {
          discount: this.discountOutcome(record, hypothetical, prepared.discountPlan, {
            discountChangeId: null,
            refundChangeId: null,
            correctionChangeId: null,
            refundIntentFailed: false,
            correctionFailed: false,
          }),
        }),
      };
    }

    if (prepared.recoverChangeId !== undefined) {
      return this.finishInterruptedEdit(record, prepared, prepared.recoverChangeId, input.actorUserId);
    }

    if (prepared.ensureOnly && prepared.discountPlan !== undefined) {
      const discountChangeId = record.orderEdits?.discount?.changeId ?? '';
      const ensured = await this.followUpDiscount(record, prepared.discountPlan, discountChangeId, false);
      return {
        dryRun: false,
        changeId: discountChangeId,
        view: (await this.getEditsView(record)) as OrderEditsView,
        stock: [],
        discount: ensured,
      };
    }

    const { change } = await this.changes.openOrReuse({
      internalOrderId: input.internalOrderId,
      kind: prepared.kind,
      targetRef: prepared.targetRef,
      payload: prepared.payload,
      requestedBy: input.actorUserId,
      requestedAt: new Date(),
    });

    const stamped = this.stampChange(prepared.patch, change.id);
    const written = await this.orderRecords.applyOrderEdit({
      internalOrderId: input.internalOrderId,
      expectedRev,
      ...stamped,
    });
    if (written === null) {
      await this.changes.abandon(change.id);
      // B-39: a re-ingestion can flip the order back to `awaiting_mapping` between
      // the read and the write; that is not "somebody else edited it".
      const latest = await this.orderRecords.getOrderRecord(input.internalOrderId);
      if (latest !== null && latest.recordStatus !== 'ready') {
        throw new OrderEditRefusedError(
          'ORDER_NOT_READY',
          'This order was re-imported while you were editing and its products are not matched yet. Fix the product mapping, then edit it again.'
        );
      }
      throw new OrderEditRefusedError(
        'ORDER_EDIT_CONTENDED',
        'The order changed while you were editing it. Reload it and try again.'
      );
    }

    const stock = await this.followUpLines(written, prepared, change.id);
    const discount =
      prepared.discountPlan === undefined
        ? undefined
        : await this.followUpDiscount(written, prepared.discountPlan, change.id, true);

    const confirmed = await this.changes.confirm(change.id, `operator:${input.actorUserId ?? 'system'}`);
    if (confirmed) {
      await this.changes.claimApplied(change.id);
    } else {
      this.logger.warn(
        `Change ${change.id} was no longer open when confirming the ${prepared.kind} of order ` +
          `${input.internalOrderId}; the overlay is written and the order is edited`
      );
    }

    this.logger.log(
      `Order ${input.internalOrderId} edited by ${input.actorUserId ?? 'system'} (${prepared.kind}, change ${change.id}); ` +
        `${written.sourceConnectionId} keeps the original`
    );

    return {
      dryRun: false,
      changeId: change.id,
      view: (await this.getEditsView(written)) as OrderEditsView,
      stock,
      ...(discount !== undefined && { discount }),
    };
  }

  /**
   * B-30: the process died after the overlay write and before the follow-ups. The
   * overlay holds the requested quantities and the change row is still open, so a
   * retry must finish the job instead of answering NOTHING_CHANGED. The change's
   * own payload says which lines and how many units.
   */
  private async findInterruptedLineEdit(
    record: OrderRecord,
    requested: ReadonlyArray<{ orderLineId: string; quantity: number }>
  ): Promise<PreparedEdit | null> {
    const targetRef = lineQuantityEditTargetRef(record.internalOrderId);
    const history = await this.changes.findByOrderAndKinds(record.internalOrderId, [
      'order.line_quantity_change',
    ]);
    const open = history
      .filter((change) => change.targetRef === targetRef && OPEN_ORDER_CHANGE_STATUSES.includes(change.status))
      .at(-1);
    if (open === undefined) return null;
    const payloadLines = open.payload?.lines;
    if (!Array.isArray(payloadLines)) return null;

    const lowered: Array<{ orderLineId: string; newQuantity: number; removedUnits: number }> = [];
    for (const raw of payloadLines) {
      if (typeof raw !== 'object' || raw === null) return null;
      const entry = raw as Record<string, unknown>;
      if (
        typeof entry.orderLineId !== 'string' ||
        typeof entry.to !== 'number' ||
        typeof entry.removed !== 'number'
      ) {
        return null;
      }
      const stamped = record.orderEdits?.lines?.[entry.orderLineId];
      // The overlay must actually carry THIS change's write, or there is
      // nothing interrupted to finish.
      if (stamped === undefined || stamped.changeId !== open.id || stamped.quantity !== entry.to) {
        return null;
      }
      lowered.push({ orderLineId: entry.orderLineId, newQuantity: entry.to, removedUnits: entry.removed });
    }
    if (lowered.length === 0) return null;
    // Only the lines the retry named are in scope for a recovery.
    const named = new Set(requested.map((line) => line.orderLineId));
    if (!lowered.some((line) => named.has(line.orderLineId))) return null;

    return {
      kind: 'order.line_quantity_change',
      targetRef,
      payload: open.payload ?? {},
      patch: {},
      loweredLines: lowered,
      recoverChangeId: open.id,
    };
  }

  private async finishInterruptedEdit(
    record: OrderRecord,
    prepared: PreparedEdit,
    changeId: string,
    actorUserId: string | null
  ): Promise<OrderEditResult> {
    const stock = await this.followUpLines(record, prepared, changeId);
    const confirmed = await this.changes.confirm(changeId, `operator:${actorUserId ?? 'system'}`);
    if (confirmed) {
      await this.changes.claimApplied(changeId);
    }
    this.logger.warn(
      `Finished an interrupted ${prepared.kind} of order ${record.internalOrderId} (change ${changeId}): ` +
        `the overlay was already written, the follow-ups and the confirmation were re-run`
    );
    return {
      dryRun: false,
      changeId,
      view: (await this.getEditsView(record)) as OrderEditsView,
      stock,
    };
  }

  /** Every refusal that needs no write to decide, in the order the operator reads them. */
  private async assertEditable(
    record: OrderRecord,
    shipments: readonly Shipment[],
    assessment: OrderWorkEditAssessment
  ): Promise<void> {
    if (record.cancelledAt !== null) {
      throw new OrderEditRefusedError('ORDER_ALREADY_CANCELLED', 'This order is cancelled, so it cannot be edited.');
    }
    if (record.recordStatus !== 'ready') {
      throw new OrderEditRefusedError(
        'ORDER_NOT_READY',
        'This order has not finished importing (its products are not matched yet). Fix the product mapping first.'
      );
    }
    const leftWithCarrier = shipments.some((s) => LEFT_THE_BUILDING_STATUSES.includes(s.status));
    if (
      leftWithCarrier ||
      record.fulfillmentState === 'dispatched' ||
      record.fulfillmentState === 'delivered'
    ) {
      throw new OrderEditRefusedError(
        'ORDER_ALREADY_SHIPPED',
        'This order has already shipped, so it cannot be edited. Use the returns flow when the parcel comes back.'
      );
    }
    const open = await this.changes.findOpenByOrder(record.internalOrderId);
    const amendmentKinds: readonly string[] = OrderAmendmentRequestKindValues;
    if (
      open.some((change) => amendmentKinds.includes(change.kind)) ||
      record.activeHoldReason === 'awaiting-amendment'
    ) {
      throw new OrderEditRefusedError(
        'ORDER_AMENDMENT_IN_FLIGHT',
        'A cancellation of this order is waiting for the sales channel to answer. Wait for it to finish before editing.'
      );
    }
    if (record.packedAt !== null || assessment.anyParcelClosed) {
      throw new OrderEditRefusedError(
        'ORDER_PACKED',
        'This order is already packed. Unpack it first (Mark as not packed), then edit it.'
      );
    }
  }

  private assertLabelNotBought(shipments: readonly Shipment[]): void {
    if (shipments.some((s) => LABEL_BOUGHT_STATUSES.includes(s.status))) {
      throw new OrderEditRefusedError(
        'LABEL_ALREADY_BOUGHT',
        'A shipping label was already bought for this order and it carries the current address and method. Void the label first, then edit.'
      );
    }
  }

  /**
   * Work offered to or accepted by a holder that is NOT OpenLinker's own executor
   * has been sent a ship-to that cannot be changed. Unreachable today - see the
   * module note.
   */
  private async assertNotHandedOff(assessment: OrderWorkEditAssessment): Promise<void> {
    for (const work of assessment.handedOff) {
      if (work.assignedConnectionId === null) continue;
      if (!(await this.isOpenLinkerExecutor(work.assignedConnectionId))) {
        throw new OrderEditRefusedError(
          'EDIT_AFTER_HANDOFF',
          'This order was already sent to an outside warehouse that cannot be told about the change. Ask the warehouse to change it, or cancel and re-route the order.'
        );
      }
    }
  }

  /**
   * Picking has started, or an OUTSIDE holder has taken the work: lowering a line
   * changes someone's work underneath them. OpenLinker's own executor accepts
   * every work the moment it is dispatched, so `accepted` alone says nothing there
   * and must not make every routed order need an acknowledgement.
   */
  private async isUnderway(assessment: OrderWorkEditAssessment): Promise<boolean> {
    for (const work of assessment.handedOff) {
      if (work.status === 'in_progress') return true;
      if (work.assignedConnectionId !== null && !(await this.isOpenLinkerExecutor(work.assignedConnectionId))) {
        return true;
      }
    }
    return false;
  }

  private async isOpenLinkerExecutor(connectionId: string): Promise<boolean> {
    try {
      const connection: Connection = await this.connections.get(connectionId);
      const metadata = await this.integrations.resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      });
      return metadata.adapterKey === OMS_ADAPTER_KEY;
    } catch (error) {
      // An unresolvable holder is treated as an outside one: refusing is the
      // safe answer when OpenLinker cannot show the change would reach it.
      this.logger.warn(
        `Could not resolve the holder ${connectionId} of an order being edited: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }

  private async hasIssuedDocument(record: OrderRecord): Promise<boolean> {
    const latest = await this.invoices.getLatestInvoiceForOrder(record.internalOrderId);
    if (latest !== null && latest.blocksIssuanceElsewhere) return true;
    const registrations = await this.fiscal.getByOrderId(record.internalOrderId);
    return registrations.some((registration) => registration.blocksFurtherRegistration);
  }

  /**
   * Lines only, after the overlay is written. Each step is idempotent and keyed
   * on this change, so a retried edit finishes what a crash left undone.
   */
  private async followUpLines(
    written: OrderRecord,
    prepared: PreparedEdit,
    changeId: string
  ): Promise<OrderEditLineStock[]> {
    if (prepared.loweredLines.length === 0) return [];

    for (const line of prepared.loweredLines) {
      try {
        await this.fulfillmentEdit.lowerLineQuantity({
          orderId: written.internalOrderId,
          orderLineId: line.orderLineId,
          newQuantity: line.newQuantity,
        });
      } catch (error) {
        // The overlay is already written and the order IS edited; a work that
        // refuses (units already fulfilled raced in) is reported, never swallowed.
        this.logger.error(
          `Could not narrow the work for line ${line.orderLineId} of order ${written.internalOrderId}: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }

    try {
      await this.reservations.narrowForOrder({
        orderRecordId: written.internalOrderId,
        lines: prepared.loweredLines.map((line) => ({
          orderLineId: line.orderLineId,
          quantity: line.newQuantity,
        })),
      });
    } catch (error) {
      this.logger.error(
        `Could not lower the reservation of order ${written.internalOrderId}; the next ingestion re-reserves from the edited order: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }

    const stock: OrderEditLineStock[] = [];
    for (const line of prepared.loweredLines) {
      try {
        const reversed = await this.saleReversal.reverseLineQuantity({
          internalOrderId: written.internalOrderId,
          orderLineId: line.orderLineId,
          units: line.removedUnits,
          changeId,
        });
        stock.push({
          orderLineId: line.orderLineId,
          stockRestored:
            reversed.status === 'restored' ? true : reversed.status === 'failed' ? false : 'not-applicable',
          detail: reversed.detail,
        });
      } catch (error) {
        stock.push({
          orderLineId: line.orderLineId,
          stockRestored: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return stock;
  }

  private stampChange(
    patch: PreparedEdit['patch'],
    changeId: string
  ): PreparedEdit['patch'] {
    return {
      ...(patch.address !== undefined && { address: { ...patch.address, changeId } }),
      ...(patch.deliveryMethod !== undefined && {
        deliveryMethod: { ...patch.deliveryMethod, changeId },
      }),
      ...(patch.discount !== undefined && { discount: { ...patch.discount, changeId } }),
      ...(patch.lines !== undefined && {
        lines: Object.fromEntries(
          Object.entries(patch.lines).map(([lineId, line]) => [lineId, { ...line, changeId }])
        ),
      }),
    };
  }

  /** The overlay as it WOULD be after this edit, for the dry run. */
  private hypotheticalEdits(record: OrderRecord, prepared: PreparedEdit): OrderEdits {
    const stamped = this.stampChange(prepared.patch, 'preview');
    const current = record.orderEdits;
    return {
      v: 1,
      rev: (current?.rev ?? 0) + 1,
      ...(current?.address !== undefined && { address: current.address }),
      ...(current?.deliveryMethod !== undefined && { deliveryMethod: current.deliveryMethod }),
      ...((stamped.discount ?? current?.discount) !== undefined && {
        discount: (stamped.discount ?? current?.discount) as OrderDiscountEdit,
      }),
      ...((current?.lines !== undefined || stamped.lines !== undefined) && {
        lines: { ...(current?.lines ?? {}), ...(stamped.lines ?? {}) },
      }),
      ...(stamped.address !== undefined && { address: stamped.address }),
      ...(stamped.deliveryMethod !== undefined && { deliveryMethod: stamped.deliveryMethod }),
    };
  }

  private async viewAfter(record: OrderRecord, edits: OrderEdits): Promise<OrderEditsView> {
    const [existing, open] = await Promise.all([
      this.changes.findByOrderAndKinds(record.internalOrderId, OrderOperatorEditKindValues),
      this.changes.findOpenByOrder(record.internalOrderId),
    ]);
    return buildOrderEditsView(
      record.channelSnapshot,
      edits,
      buildOrderEditHistory(existing, record.sourceConnectionId),
      buildDiscountProposals(open)
    );
  }

  // ---- the discount money event (#3543) ----

  private async prepareDiscount(
    input: EditOrderDiscountInput,
    record: OrderRecord,
    shipments: readonly Shipment[]
  ): Promise<PreparedEdit> {
    if ((input.amount === null) === (input.percent === null)) {
      throw new OrderEditInvalidError('Give either an amount or a percent, not both and not neither.');
    }
    const currency = this.readCurrency(record);
    const exponent = minorUnitExponentFor(currency);
    const baseSnapshot = applyOrderEditsToSnapshot(
      record.channelSnapshot,
      this.withoutDiscount(record.orderEdits)
    );
    const baseItems = this.readRawLines(baseSnapshot.items);
    const baseTotal = this.readTotal(baseSnapshot);

    const amount = this.resolveDiscountAmount(input, goodsGrossValue(baseItems), currency, exponent);
    const currentAmount = effectiveDiscountAmount(record.orderEdits?.discount);
    const sameAmount = amount === currentAmount;
    if (sameAmount && amount === 0) {
      throw new OrderEditRefusedError('NOTHING_CHANGED', 'This order has no discount to remove.');
    }

    let plan: PlannedOrderDiscount | null = null;
    if (amount > 0) {
      plan = planOrderDiscount(baseItems, amount, currency);
      if (baseTotal === null || amount >= baseTotal || plan === null) {
        throw new OrderEditRefusedError(
          'DISCOUNT_EXCEEDS_TOTAL',
          'A discount must be less than what the buyer is charged for the goods. To give everything back, cancel the order instead.'
        );
      }
    }

    const paymentBranch = this.paymentBranchOf(record);
    if (paymentBranch === 'cod') {
      this.assertLabelNotBoughtForCod(shipments);
    }

    const { correction, correctionUnavailableReason } = await this.planCorrection(
      record,
      baseItems,
      plan,
      currency,
      paymentBranch
    );
    const refund = await this.planRefund(record, amount, paymentBranch, currency, exponent, input);

    if (sameAmount) {
      // Idempotent resubmission: the discount is saved, so only a proposal a
      // failed earlier attempt left behind may still be missing.
      const open = await this.changes.findOpenByOrder(record.internalOrderId);
      const refundMissing =
        refund !== null && !open.some((change) => change.kind === 'order.discount_refund');
      const correctionMissing =
        correction !== null &&
        !open.some(
          (change) =>
            change.kind === 'order.discount_correction' &&
            change.payload?.invoiceRecordId === correction.invoice.id
        );
      if (!refundMissing && !correctionMissing) {
        throw new OrderEditRefusedError('NOTHING_CHANGED', 'The order already has that discount.');
      }
      const existing = record.orderEdits?.discount as OrderDiscountEdit;
      return {
        kind: 'order.discount_change',
        targetRef: discountEditTargetRef(record.internalOrderId),
        payload: {},
        patch: { discount: existing },
        loweredLines: [],
        ensureOnly: true,
        discountPlan: {
          paymentBranch,
          currency,
          amount,
          refund: refundMissing ? refund : null,
          correction: correctionMissing ? correction : null,
          correctionUnavailableReason,
        },
      };
    }

    const now = new Date().toISOString();
    const discount: OrderDiscountEdit = {
      changeId: '',
      editedAt: now,
      editedBy: input.actorUserId,
      amount: amount.toFixed(exponent),
      currency,
      perLine: (plan?.perLine ?? [])
        .filter((line) => line.share > 0)
        .map((line) => ({ orderItemId: line.orderItemId, amount: line.share.toFixed(exponent) })),
    };

    return {
      kind: 'order.discount_change',
      targetRef: discountEditTargetRef(record.internalOrderId),
      // No buyer data: amounts and the payment branch the money event followed.
      payload: { amount: discount.amount, currency, previous: currentAmount.toFixed(exponent), paymentBranch },
      patch: { discount },
      loweredLines: [],
      discountPlan: {
        paymentBranch,
        currency,
        amount,
        refund,
        correction,
        correctionUnavailableReason,
      },
    };
  }

  private resolveDiscountAmount(
    input: EditOrderDiscountInput,
    goodsValue: number,
    currency: string,
    exponent: number
  ): number {
    if (input.amount !== null) {
      if (!isDecimalAmountText(input.amount)) {
        throw new OrderEditInvalidError('The discount amount must be a plain decimal number such as 12.50.');
      }
      if (decimalPlaces(input.amount) > exponent) {
        throw new OrderEditInvalidError(
          `${currency} has ${String(exponent)} decimal place(s); the discount amount has more.`
        );
      }
      return Number(Number(input.amount).toFixed(exponent));
    }
    const percent = input.percent as number;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new OrderEditInvalidError('The discount percent must be between 0 and 100.');
    }
    return Number(((goodsValue * percent) / 100).toFixed(exponent));
  }

  /** The overlay minus its discount: the base a discount is sized against. */
  private withoutDiscount(edits: OrderEdits | null): OrderEdits | null {
    if (edits === null) return null;
    return {
      v: 1,
      rev: edits.rev,
      ...(edits.address !== undefined && { address: edits.address }),
      ...(edits.lines !== undefined && { lines: edits.lines }),
      ...(edits.deliveryMethod !== undefined && { deliveryMethod: edits.deliveryMethod }),
    };
  }

  /** Lowering a line must not leave a standing discount larger than the goods it applies to. */
  private assertDiscountStillFits(
    record: OrderRecord,
    patchLines: Readonly<Record<string, { quantity: number }>>
  ): void {
    const discount = record.orderEdits?.discount;
    const amount = effectiveDiscountAmount(discount);
    if (discount === undefined || amount === 0) return;
    const current = record.orderEdits;
    const base = applyOrderEditsToSnapshot(record.channelSnapshot, {
      v: 1,
      rev: current?.rev ?? 0,
      lines: {
        ...(current?.lines ?? {}),
        ...Object.fromEntries(
          Object.entries(patchLines).map(([lineId, line]) => [
            lineId,
            { changeId: '', editedAt: '', editedBy: null, quantity: line.quantity },
          ])
        ),
      },
    });
    const total = this.readTotal(base);
    if (
      total === null ||
      amount >= total ||
      planOrderDiscount(this.readRawLines(base.items), amount, discount.currency) === null
    ) {
      throw new OrderEditRefusedError(
        'DISCOUNT_EXCEEDS_TOTAL',
        'The order discount would be larger than what is left after lowering those quantities. Lower or remove the discount first.'
      );
    }
  }

  private paymentBranchOf(record: OrderRecord): DiscountPaymentBranch {
    const status = record.paymentStatus;
    if (status === 'paid') return 'paid';
    if (status === 'cod') return 'cod';
    if (record.paymentMethodOrUnknown === 'cash_on_delivery') return 'cod';
    if (status === 'awaiting') return 'unpaid';
    return 'unknown';
  }

  private assertLabelNotBoughtForCod(shipments: readonly Shipment[]): void {
    if (shipments.some((s) => LABEL_BOUGHT_STATUSES.includes(s.status))) {
      throw new OrderEditRefusedError(
        'LABEL_ALREADY_BOUGHT',
        'A shipping label was already bought and it carries the cash-on-delivery amount from before the discount. Void the label first, then add the discount.'
      );
    }
  }

  /**
   * Paid orders only: the part of the discount not already refunded. Checked
   * against the refund ceiling NOW, so an operator is told before the discount
   * is saved rather than when they confirm the refund.
   */
  private async planRefund(
    record: OrderRecord,
    amount: number,
    branch: DiscountPaymentBranch,
    currency: string,
    exponent: number,
    input: EditOrderDiscountInput
  ): Promise<DiscountPlan['refund']> {
    if (branch !== 'paid') return null;
    const priorChanges = await this.changes.findByOrderAndKinds(record.internalOrderId, [
      'order.discount_refund',
    ]);
    // Only a CONFIRMED intent has actually been refunded; an open one is
    // replaced by this edit, so counting it would under-refund.
    const alreadyRefunded = priorChanges
      .filter((change) => change.status === 'confirmed')
      .reduce((sum, change) => sum + Number(change.payload?.amount ?? 0), 0);
    const due = Number((amount - alreadyRefunded).toFixed(exponent));
    if (!(due > 0)) return null;

    const summaries = await this.refunds.getRefundSummariesForOrders([record.internalOrderId]);
    const verdict = evaluateRefundCeiling({
      context: {
        order: {
          totalAmount: record.totalAmount,
          currency: record.currency,
          taxTreatment: record.taxTreatment,
          totalTaxTreatment: record.totalTaxTreatment,
        },
        alreadyRefunded: summaries.get(record.internalOrderId) ?? null,
      },
      requestedAmount: due.toFixed(exponent),
      requestedCurrency: currency,
    });
    // Throws RefundCeilingExceededException (409 refund_ceiling_exceeded) unless acknowledged.
    decideRefundCeiling(record.internalOrderId, verdict, input.acknowledgeAboveCeiling);
    return { amount: due.toFixed(exponent), verdict };
  }

  /**
   * Whether an already issued invoice must be corrected, and to what. Built from
   * the CHANNEL lines (absolute new prices), so a replaced discount converges and a
   * removed one restores the channel price, whatever the document says now.
   */
  private async planCorrection(
    record: OrderRecord,
    baseItems: readonly RawOrderLine[],
    plan: PlannedOrderDiscount | null,
    currency: string,
    branch: DiscountPaymentBranch
  ): Promise<{
    correction: PlannedCorrection | null;
    correctionUnavailableReason: DiscountCorrectionUnavailableReason | null;
  }> {
    const registrations = await this.fiscal.getByOrderId(record.internalOrderId);
    const receipt = registrations.some((registration) => registration.blocksFurtherRegistration);
    if (receipt) {
      if (branch === 'paid') {
        throw new OrderEditRefusedError(
          'ORDER_HAS_FISCAL_RECEIPT',
          'A fiscal receipt was registered for this order and OpenLinker cannot correct a receipt, so a discount on a paid order cannot be reflected on it. Correct the sale on the fiscal device or with the receipt provider.'
        );
      }
      return { correction: null, correctionUnavailableReason: 'fiscal-receipt' };
    }

    const latest = await this.invoices.getLatestInvoiceForOrder(record.internalOrderId);
    if (latest === null || !latest.blocksIssuanceElsewhere) {
      return { correction: null, correctionUnavailableReason: null };
    }
    if (latest.status !== 'issued') {
      throw new OrderEditRefusedError(
        'INVOICE_NOT_SETTLED',
        'The invoice for this order has not finished issuing, so it cannot be corrected yet. Wait for it to settle, then add the discount.'
      );
    }
    const snapshot = latest.issuedLineSnapshot;
    if (!snapshot) return { correction: null, correctionUnavailableReason: 'no-line-snapshot' };
    if (!latest.providerInvoiceId || !latest.providerInvoiceNumber || !latest.issuedAt) {
      return { correction: null, correctionUnavailableReason: 'not-fully-issued' };
    }

    const shares = new Map((plan?.perLine ?? []).map((line) => [line.orderItemId, line.share]));
    const itemsById = new Map(baseItems.map((item) => [item.id, item]));
    const exponent = minorUnitExponentFor(currency);
    const matched = new Set<string>();
    const lines: DiscountCorrectionLine[] = [];
    let unmatched = false;

    snapshot.lines.forEach((line, index) => {
      let item: RawOrderLine | undefined =
        line.orderLineId === undefined ? undefined : itemsById.get(line.orderLineId);
      if (item === undefined && line.orderLineId === undefined) {
        // A document issued before lines carried their order line id: the goods
        // lines come first and in order, so match by position AND product.
        const candidate = baseItems[index];
        if (candidate !== undefined && candidate.productId !== null && candidate.productId === line.productId) {
          item = candidate;
        } else if (index < baseItems.length) {
          unmatched = true;
        }
      }
      if (item === undefined) return;
      matched.add(item.id);
      const next = discountedUnitPriceGross(item, shares.get(item.id) ?? 0, currency);
      if (Math.abs(next - line.unitPriceGross) >= 0.5 / 10 ** exponent) {
        lines.push({
          originalLineNumber: index + 1,
          name: line.name,
          previousUnitPriceGross: line.unitPriceGross,
          newUnitPriceGross: next,
        });
      }
    });
    if (unmatched || [...shares.keys()].some((id) => !matched.has(id))) {
      return { correction: null, correctionUnavailableReason: 'unmatched-lines' };
    }
    if (lines.length === 0) return { correction: null, correctionUnavailableReason: null };
    return { correction: { invoice: latest, lines }, correctionUnavailableReason: null };
  }

  /**
   * After the overlay is written: retire the proposals of the discount this one
   * replaced, then open the new ones. Best-effort per proposal - the order IS
   * discounted by now, so a failure is REPORTED (`refundIntentFailed`,
   * `proposal-failed`) and never undone.
   */
  private async followUpDiscount(
    written: OrderRecord,
    plan: DiscountPlan,
    discountChangeId: string,
    retireOpenProposals: boolean
  ): Promise<OrderDiscountOutcome> {
    const orderId = written.internalOrderId;
    let refundChangeId: string | null = null;
    let correctionChangeId: string | null = null;
    let refundIntentFailed = false;
    let correctionFailed = false;

    try {
      const open = retireOpenProposals ? await this.changes.findOpenByOrder(orderId) : [];
      for (const change of open) {
        if (change.kind === 'order.discount_refund' || change.kind === 'order.discount_correction') {
          await this.changes.abandon(change.id);
        }
      }
    } catch (error) {
      this.logger.error(
        `Could not retire the earlier discount proposals of order ${orderId}: ${this.describe(error)}`
      );
    }

    if (plan.refund !== null) {
      try {
        const { change } = await this.changes.openOrReuse({
          internalOrderId: orderId,
          kind: 'order.discount_refund',
          targetRef: discountRefundTargetRef(orderId, discountChangeId),
          payload: {
            amount: plan.refund.amount,
            currency: plan.currency,
            reason: 'other',
            note: 'Discount granted in OpenLinker',
          },
          requestedBy: written.orderEdits?.discount?.editedBy ?? null,
          requestedAt: new Date(),
        });
        refundChangeId = change.id;
      } catch (error) {
        refundIntentFailed = true;
        this.logger.error(
          `order_discount_refund_intent_failed order=${orderId} change=${discountChangeId}: ${this.describe(error)}`
        );
      }
    }

    if (plan.correction !== null) {
      try {
        const { invoice, lines } = plan.correction;
        const { change } = await this.changes.openOrReuse({
          internalOrderId: orderId,
          kind: 'order.discount_correction',
          targetRef: discountCorrectionTargetRef(orderId, invoice.id),
          payload: {
            invoiceRecordId: invoice.id,
            documentNumber: invoice.providerInvoiceNumber,
            currency: plan.currency,
            reason: plan.amount > 0 ? 'Discount granted in OpenLinker' : 'Discount removed in OpenLinker',
            lines,
          },
          requestedBy: written.orderEdits?.discount?.editedBy ?? null,
          requestedAt: new Date(),
        });
        correctionChangeId = change.id;
      } catch (error) {
        correctionFailed = true;
        this.logger.error(
          `order_discount_correction_proposal_failed order=${orderId} change=${discountChangeId}: ${this.describe(error)}`
        );
      }
    }

    return this.discountOutcome(written, written.orderEdits as OrderEdits, plan, {
      discountChangeId,
      refundChangeId,
      correctionChangeId,
      refundIntentFailed,
      correctionFailed,
    });
  }

  private discountOutcome(
    record: OrderRecord,
    edits: OrderEdits,
    plan: DiscountPlan,
    ids: {
      discountChangeId: string | null;
      refundChangeId: string | null;
      correctionChangeId: string | null;
      refundIntentFailed: boolean;
      correctionFailed: boolean;
    }
  ): OrderDiscountOutcome {
    const effective = applyOrderEditsToSnapshot(record.channelSnapshot, edits);
    const exponent = minorUnitExponentFor(plan.currency);
    const total = this.readTotal(effective);
    const cod =
      typeof effective.codToCollect === 'object' && effective.codToCollect !== null
        ? (effective.codToCollect as Record<string, unknown>)
        : null;
    let amountToCollect: OrderDiscountOutcome['amountToCollect'] = null;
    if (plan.paymentBranch !== 'paid' && plan.paymentBranch !== 'unknown') {
      if (plan.paymentBranch === 'cod' && cod !== null && typeof cod.amount === 'string') {
        amountToCollect = { amount: cod.amount, currency: plan.currency };
      } else if (total !== null) {
        amountToCollect = { amount: total.toFixed(exponent), currency: plan.currency };
      }
    }

    const refundIntent: DiscountRefundIntent | null =
      plan.refund === null || ids.refundIntentFailed
        ? null
        : {
            changeId: ids.refundChangeId,
            amount: plan.refund.amount,
            currency: plan.currency,
            ceiling:
              plan.refund.verdict.status === 'unknown'
                ? { status: 'unknown', reason: plan.refund.verdict.reason }
                : { ...plan.refund.verdict },
          };

    let correctionProposal: DiscountCorrectionProposal | null = null;
    let correctionUnavailableReason = plan.correctionUnavailableReason;
    if (plan.correction !== null) {
      if (ids.correctionFailed) {
        correctionUnavailableReason = 'proposal-failed';
      } else {
        correctionProposal = {
          changeId: ids.correctionChangeId,
          invoiceRecordId: plan.correction.invoice.id,
          documentNumber: plan.correction.invoice.providerInvoiceNumber,
          currency: plan.currency,
          lines: plan.correction.lines,
        };
      }
    }

    return {
      discount:
        edits.discount !== undefined && effectiveDiscountAmount(edits.discount) > 0
          ? edits.discount
          : null,
      paymentBranch: plan.paymentBranch,
      amountToCollect,
      refundIntent,
      refundIntentFailed: ids.refundIntentFailed,
      correctionProposal,
      correctionUnavailableReason,
    };
  }

  private readCurrency(record: OrderRecord): string {
    const totals = record.channelSnapshot.totals;
    const fromSnapshot =
      typeof totals === 'object' && totals !== null
        ? (totals as Record<string, unknown>).currency
        : undefined;
    const currency = (typeof fromSnapshot === 'string' ? fromSnapshot : (record.currency ?? '')).trim();
    if (currency === '') {
      throw new OrderEditInvalidError('This order has no currency, so a discount amount cannot be sized.');
    }
    return currency.toUpperCase();
  }

  private readTotal(snapshot: Record<string, unknown>): number | null {
    const totals = snapshot.totals;
    if (typeof totals !== 'object' || totals === null) return null;
    const total = (totals as Record<string, unknown>).total;
    return typeof total === 'number' && Number.isFinite(total) ? total : null;
  }

  private readRawLines(items: unknown): RawOrderLine[] {
    if (!Array.isArray(items)) return [];
    const out: RawOrderLine[] = [];
    for (const raw of items) {
      if (typeof raw !== 'object' || raw === null) continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.quantity !== 'number' || typeof item.price !== 'number') {
        continue;
      }
      out.push({
        id: item.id,
        quantity: item.quantity,
        price: item.price,
        ...(typeof item.unitPriceGross === 'number' && { unitPriceGross: item.unitPriceGross }),
        productId: typeof item.productId === 'string' ? item.productId : null,
        name: typeof item.name === 'string' ? item.name : null,
      });
    }
    return out;
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // ---- snapshot reads (on the EFFECTIVE view, so a second edit builds on the first) ----

  private readShippingAddress(record: OrderRecord): Address | undefined {
    const value = record.orderSnapshot.shippingAddress;
    return typeof value === 'object' && value !== null ? (value as Address) : undefined;
  }

  private readPickupId(record: OrderRecord): string | null {
    const value = record.orderSnapshot.pickupPoint;
    if (typeof value !== 'object' || value === null) return null;
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
  }

  private readPickupName(record: OrderRecord): string | null {
    const value = record.orderSnapshot.pickupPoint;
    if (typeof value !== 'object' || value === null) return null;
    const name = (value as Record<string, unknown>).name;
    return typeof name === 'string' ? name : null;
  }

  /** CHANNEL line prices by id, for the gross-unit-price check (B-38). */
  private readChannelItemPrices(
    record: OrderRecord
  ): Map<string, { id: string; quantity: number; price: number; unitPriceGross?: number }> {
    const out = new Map<string, { id: string; quantity: number; price: number; unitPriceGross?: number }>();
    const items = record.channelSnapshot.items;
    if (!Array.isArray(items)) return out;
    for (const raw of items) {
      if (typeof raw !== 'object' || raw === null) continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== 'string') continue;
      out.set(item.id, {
        id: item.id,
        quantity: typeof item.quantity === 'number' ? item.quantity : 0,
        price: typeof item.price === 'number' ? item.price : 0,
        ...(typeof item.unitPriceGross === 'number' ? { unitPriceGross: item.unitPriceGross } : {}),
      });
    }
    return out;
  }

  /** CHANNEL quantities by line id: the overlay is `min(overlay, channel)` over these. */
  private readChannelItems(record: OrderRecord): Map<string, number> {
    const out = new Map<string, number>();
    const items = record.channelSnapshot.items;
    if (!Array.isArray(items)) return out;
    for (const raw of items) {
      if (typeof raw !== 'object' || raw === null) continue;
      const item = raw as Record<string, unknown>;
      if (typeof item.id === 'string' && typeof item.quantity === 'number') {
        out.set(item.id, item.quantity);
      }
    }
    return out;
  }

  private sameAddress(a: Address, b: Address): boolean {
    const fields: ReadonlyArray<keyof Address> = [
      'firstName', 'lastName', 'company', 'address1', 'address2', 'city', 'state', 'postalCode', 'country', 'phone',
    ];
    return fields.every((field) => (a[field] ?? '') === (b[field] ?? ''));
  }

  private changedAddressFields(current: Address | undefined, next: Address): string[] {
    const fields: ReadonlyArray<keyof Address> = [
      'firstName', 'lastName', 'company', 'address1', 'address2', 'city', 'state', 'postalCode', 'country', 'phone',
    ];
    return fields.filter((field) => (current?.[field] ?? '') !== (next[field] ?? ''));
  }

  /**
   * The hash the routing projection and the address-reuse lookup key on, restamped
   * for the NEW address. Never throws: an unset salt must not turn an edit into a
   * failure, and a missing hash reads as "unknown" downstream, not as a wrong one.
   */
  private hashShipping(address: Address): string | null {
    try {
      const hash = hashAddress(
        normalizeAddress({
          address1: address.address1,
          address2: address.address2,
          city: address.city,
          postcode: address.postalCode,
          countryIso2: address.country,
        })
      );
      return hash.trim() === '' ? null : hash;
    } catch (error) {
      this.logger.warn(
        `Could not hash the edited address: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }
}
