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
 * - There is no refund intent here. A lowered total on a paid order is shown
 *   (`totals.difference`) and left to the discount money event (#3543).
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
import { INVOICE_SERVICE_TOKEN, type IInvoiceService } from '@openlinker/core/invoicing';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';
import {
  addressEditTargetRef,
  deliveryMethodEditTargetRef,
  effectiveLineQuantity,
  lineQuantityEditTargetRef,
  ORDER_CHANGE_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  OrderAmendmentRequestKindValues,
  OrderOperatorEditKindValues,
  type Address,
  type ApplyOrderEditInput,
  type IOrderChangeService,
  type IOrderRecordService,
  type OrderEdits,
  type OrderOperatorEditKind,
  type OrderRecord,
} from '@openlinker/core/orders';
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
  EditOrderAddressInput,
  EditOrderDeliveryMethodInput,
  EditOrderLinesInput,
  OrderEditLineStock,
  OrderEditResult,
  OrderEditsView,
} from '../types/order-edit.types';
import { buildOrderEditHistory, buildOrderEditsView } from './order-edits-view';

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
  /** Lines only: what to do to work, holds and stock once the overlay is written. */
  readonly loweredLines: ReadonlyArray<{
    readonly orderLineId: string;
    readonly newQuantity: number;
    readonly removedUnits: number;
  }>;
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
    private readonly lock: SyncLockPort
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
      if (currentId === input.methodId && currentPickup === nextPickup) {
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

  async getEditsView(record: OrderRecord): Promise<OrderEditsView | null> {
    const edits = record.orderEdits;
    if (edits === null) return null;
    const changes = await this.changes.findByOrderAndKinds(
      record.internalOrderId,
      OrderOperatorEditKindValues
    );
    return buildOrderEditsView(
      record.channelSnapshot,
      edits,
      buildOrderEditHistory(changes, record.sourceConnectionId)
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
      return {
        dryRun: true,
        changeId: null,
        view: await this.viewAfter(record, this.hypotheticalEdits(record, prepared)),
        stock: [],
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
      throw new OrderEditRefusedError(
        'ORDER_EDIT_CONTENDED',
        'The order changed while you were editing it. Reload it and try again.'
      );
    }

    const stock = await this.followUpLines(written, prepared, change.id);

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
      ...(current?.discount !== undefined && { discount: current.discount }),
      ...((current?.lines !== undefined || stamped.lines !== undefined) && {
        lines: { ...(current?.lines ?? {}), ...(stamped.lines ?? {}) },
      }),
      ...(stamped.address !== undefined && { address: stamped.address }),
      ...(stamped.deliveryMethod !== undefined && { deliveryMethod: stamped.deliveryMethod }),
    };
  }

  private async viewAfter(record: OrderRecord, edits: OrderEdits): Promise<OrderEditsView> {
    const existing = await this.changes.findByOrderAndKinds(
      record.internalOrderId,
      OrderOperatorEditKindValues
    );
    return buildOrderEditsView(
      record.channelSnapshot,
      edits,
      buildOrderEditHistory(existing, record.sourceConnectionId)
    );
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
