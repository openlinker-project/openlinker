/**
 * Bench Documents Service (#2418, `W3b-5`, spec § 2.6)
 *
 * What goes INSIDE the box, what goes ON it, and which finished boxes cannot go
 * out at all. Implements {@link IBenchDocumentsService}.
 *
 * ## The bench PRINTS; it never ISSUES (story F1)
 *
 * Nothing here reaches `IInvoiceService.issueInvoice`, any fiscalization write,
 * or any sales-document trigger. Trigger models are
 * `manual | auto-on-paid | auto-on-shipped | batched` — there is no "on packed",
 * and this wave adds none, because packing is not a fiscal event. An operation
 * that puts an invoice in the box configures `auto-on-paid`, and the document
 * exists long before the tote reaches a bench.
 * `bench-never-issues.spec.ts` asserts the absence by grep, the shape
 * `libs/core/src/returns/__tests__/proposal-never-issues.spec.ts` established.
 *
 * ## This is the replacement for the invoicing register
 *
 * #2413 closed `InvoicingController` to `packer`, which left the bench unable to
 * print the invoice it is supposed to put in the box. It reaches the document
 * **through the work** instead: there is no `invoiceId` parameter anywhere here,
 * so the route cannot be walked to enumerate anybody else's documents.
 *
 * ## A missing document does not block packing (story F2, decision D17)
 *
 * This read runs AFTER the box has shut, and no verification path consults it.
 * A tax-rate gap is an office problem the packer cannot fix; refusing to pack
 * piles boxes at a bench while somebody hunts for an admin, and the order still
 * needs shipping. So the surface names the reason — in #2100's own vocabulary,
 * not a second one — and gets out of the way.
 *
 * @module apps/api/src/bench/application/services
 * @implements {IBenchDocumentsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  FULFILLMENT_WORKLIST_MAX_LIMIT,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  type FulfillmentWorkView,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';
import {
  INVOICE_SERVICE_TOKEN,
  isRegulatoryDocumentReader,
  type IInvoiceService,
  type InvoicingPort,
} from '@openlinker/core/invoicing';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import { ORDER_RECORD_SERVICE_TOKEN, IOrderRecordService } from '@openlinker/core/orders';
import {
  SHIPMENT_QUERY_SERVICE_TOKEN,
  type IShipmentQueryService,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';

import { readOrderReference } from '../bench-order-facts';
import {
  BENCH_WORK_REQUEST_STATUSES,
  BENCH_WORK_STATUSES,
} from '../bench-work-eligibility';
import type { IBenchDocumentsService } from '../interfaces/bench-documents.service.interface';
import type {
  BenchDocumentsView,
  BenchInvoiceView,
  BenchLabelView,
  BenchUnlabelledParcelListView,
  BenchUnlabelledParcelView,
} from '../types/bench-parcel.types';
import { BenchExecutorResolver } from './bench-executor.resolver';

/**
 * The most finished-and-unlabelled parcels this read will report.
 *
 * Bounded for the reason the work list is: at 1000 orders a day an unbounded
 * read is a page that gets slower every week, and a silently truncated one is a
 * box nobody looks for. `total` is reported alongside so the surface can say it
 * is showing part of the set.
 */
export const BENCH_UNLABELLED_HARD_CAP = FULFILLMENT_WORKLIST_MAX_LIMIT;

@Injectable()
export class BenchDocumentsService implements IBenchDocumentsService {
  private readonly logger = new Logger(BenchDocumentsService.name);

  constructor(
    private readonly executors: BenchExecutorResolver,
    @Inject(FULFILLMENT_WORKLIST_SERVICE_TOKEN)
    private readonly worklist: IFulfillmentWorklistService,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orders: IOrderRecordService,
    @Inject(SHIPMENT_QUERY_SERVICE_TOKEN)
    private readonly shipments: IShipmentQueryService
  ) {}

  async getDocuments(work: FulfillmentWorkView, canSeeCarrierText: boolean): Promise<BenchDocumentsView> {
    const [invoice, label] = await Promise.all([
      this.describeInvoice(work.orderId),
      this.describeLabel(work.id, canSeeCarrierText),
    ]);
    return { workId: work.id, invoice, label };
  }

  /**
   * The invoice, and whether the bench can actually print it.
   *
   * `ready` means issued AND printable, deliberately: the machine-readable
   * source document is XML, and a `rendered` document exists only when the
   * provider produces one server-side. Answering "ready to print" and then 409ing
   * the press is exactly the silent failure story F2 exists to remove, so the
   * printability test here MIRRORS the register route's own conditions rather
   * than approximating them — reported and printable are one decision.
   */
  private async describeInvoice(orderId: string): Promise<BenchInvoiceView> {
    const record = await this.invoices.getLatestIssuedInvoiceForOrder(orderId);

    if (record === null) {
      // Nothing was issued. The reason — if anything recorded one — is #2100's,
      // read off the order rather than re-derived, because re-deriving it here
      // would be a second answer to a question that already has one.
      const order = (await this.orders.findByIds([orderId]))[0];
      return {
        state: 'missing',
        blockReason: order?.salesDocumentBlockReason ?? null,
        unresolvedReason: order?.salesDocumentUnresolvedReason ?? null,
      };
    }

    const printable = await this.canRenderDocument(record.connectionId, record.regulatoryStatus);
    return {
      state: printable ? 'ready' : 'issued-not-printable',
      invoiceId: record.id,
      documentNumber: record.documentNumber ?? null,
      issuedAt: record.issuedAt?.toISOString() ?? null,
    };
  }

  /**
   * Can this invoice's provider hand us something a packer can fold into a box?
   *
   * The two conditions the register's own download route applies to `rendered`:
   * the clearance is `accepted`, and the adapter narrows to
   * `RegulatoryDocumentReader`. A provider that cannot be resolved at all
   * degrades to "not printable" rather than failing the read — a disabled
   * invoicing connection must not blank the label half of this surface too.
   */
  private async canRenderDocument(connectionId: string, regulatoryStatus: string): Promise<boolean> {
    if (regulatoryStatus !== 'accepted') return false;
    try {
      const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
        connectionId,
        'Invoicing'
      );
      return isRegulatoryDocumentReader(adapter);
    } catch (error) {
      this.logger.warn(
        `Could not resolve the invoicing adapter for connection ${connectionId}; reporting the ` +
          `invoice as not printable at the bench: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * The label, in the three states the bench can be in (stories F3, F4).
   *
   * Read from the shipment linked to THIS work (#2402), never from the order:
   * a split order has one shipment per parcel, and answering with the order's
   * would put another box's tracking number on this one's screen.
   */
  private async describeLabel(workId: string, canSeeCarrierText: boolean): Promise<BenchLabelView> {
    const byWork = await this.shipments.findByFulfillmentWorkIds([workId], 'outbound');
    const shipments = byWork.get(workId) ?? [];
    if (shipments.length === 0) return { state: 'none' };

    const ready = shipments.find((shipment) => shipment.providerShipmentId !== null);
    if (ready !== undefined) {
      return {
        state: 'ready',
        shipmentId: ready.id,
        carrier: ready.carrier,
        trackingNumber: ready.trackingNumber,
      };
    }

    // Packed and unlabelled — the state Surface F exists for. Newest first, so
    // the reason shown is the most recent attempt's rather than the first.
    const latest = [...shipments].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )[0];

    return {
      state: 'unavailable',
      shipmentId: latest.id,
      carrier: latest.carrier,
      providerCode: latest.providerCode,
      // Gated exactly as `ShipmentResponseDto` gates it: the raw carrier
      // rejection text may embed address fragments, and a `packer` holds no
      // permissions at all. `providerCode` above is a short discriminator and is
      // never redacted — the same distinction that DTO already draws.
      carrierMessage: canSeeCarrierText ? latest.errorMessage : null,
      // So the surface can say "hidden from your role" rather than "the carrier
      // gave no reason", which for a packer would otherwise be false whenever a
      // reason exists.
      carrierMessageRedacted: !canSeeCarrierText && latest.errorMessage !== null,
      failedAt: latest.failedAt?.toISOString() ?? null,
    };
  }

  async listUnlabelled(): Promise<BenchUnlabelledParcelListView> {
    const executors = await this.executors.listPackingExecutors();
    if (executors.length === 0) return { parcels: [], total: 0, truncated: false };

    // Scoped to this bench's own executor, closed, and bounded — the same three
    // properties the work list has, for the same reasons.
    //
    // `status` is the shared selection half of the D2 rule (#2905 review). Its
    // omission made this a THIRD spelling of "is this a bench parcel": the list
    // filters on `BENCH_WORK_STATUSES` and the open path applies the same set
    // through `isBenchWorkSelectable`, so a work at `closed` or `incomplete`
    // was listed here and then 404'd on click — D2's disagreement exactly, and
    // the omission the single-rule spec now fails the build on.
    const page = await this.worklist.list({
      assignedConnectionId: executors.map((executor) => executor.id),
      status: BENCH_WORK_STATUSES,
      requestStatus: BENCH_WORK_REQUEST_STATUSES,
      parcelClosed: true,
      orderBy: 'createdAt_ASC',
      limit: BENCH_UNLABELLED_HARD_CAP,
    });

    if (page.works.length === 0) return { parcels: [], total: 0, truncated: false };

    const workIds = page.works.map((work) => work.id);
    const orderIds = [...new Set(page.works.map((work) => work.orderId))];
    // Both batched across the whole page, never per row — the #2083 rule.
    const [shipmentsByWork, orders, siblings] = await Promise.all([
      this.shipments.findByFulfillmentWorkIds(workIds, 'outbound'),
      this.orders.findByIds(orderIds),
      this.worklist.listSiblingWorkIds(orderIds),
    ]);
    const orderById = new Map(orders.map((order) => [order.internalOrderId, order]));

    const parcels: BenchUnlabelledParcelView[] = [];
    for (const work of page.works) {
      const shipments = shipmentsByWork.get(work.id) ?? [];
      // A parcel with a label is not this list's business. A parcel with NO
      // shipment at all is: a closed box nothing has been bought for is exactly
      // as stuck as one whose carrier refused, and hiding it would leave it on
      // a floor with nobody looking for it.
      if (shipments.some((shipment) => shipment.providerShipmentId !== null)) continue;

      const latest = [...shipments].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      )[0];
      const parcelIds = siblings.get(work.orderId) ?? [work.id];
      const index = parcelIds.indexOf(work.id);

      parcels.push({
        workId: work.id,
        orderReference: readOrderReference(orderById.get(work.orderId)) ?? work.orderId,
        parcelIndex: index >= 0 ? index + 1 : 1,
        parcelTotal: parcelIds.length > 0 ? parcelIds.length : 1,
        closedAt: work.parcelClosedAt?.toISOString() ?? null,
        carrier: latest?.carrier ?? null,
        // The code, never the prose: this list is read by a packer AND by
        // whoever runs dispatch, and only one of them may see carrier text.
        providerCode: latest?.providerCode ?? null,
      });
    }

    // `total` counts the unlabelled parcels this read FOUND, not the closed
    // parcels the query matched — a count including labelled boxes would tell
    // an operator there is work waiting that is not.
    return {
      parcels,
      total: parcels.length,
      truncated: page.works.length >= BENCH_UNLABELLED_HARD_CAP,
    };
  }
}
