/**
 * Bench Documents Controller (#2418, `W3b-5`, spec § 2.6)
 *
 * What goes INSIDE the box, what goes ON it, and which finished boxes cannot go
 * out at all.
 *
 * ## The bench PRINTS; it never ISSUES (story F1)
 *
 * No route here creates a document, and this wave adds no sales-document
 * trigger. Trigger models are `manual | auto-on-paid | auto-on-shipped |
 * batched`; there is no "on packed", because packing is not a fiscal event.
 *
 * ## The invoice route is work-scoped, and that is what makes it grantable
 *
 * #2413 excluded `packer` from `GET /invoices/:invoiceId/document`, which left
 * the bench unable to print the invoice it is supposed to put in the box. This
 * is the replacement: it takes a **work id**, resolves the parcel's own order,
 * and serves that order's latest issued document. There is no `invoiceId`
 * parameter, so the route cannot be walked to reach anybody else's paperwork —
 * *"the bench reaches the parcel through the work, never by enumerating a
 * register"*, which is #2413's own principle rather than a new one.
 *
 * @module apps/api/src/bench/http
 */
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  FulfillmentWorkNotFoundError,
  type FulfillmentWorkView,
} from '@openlinker/core/fulfillment';
import {
  INVOICE_SERVICE_TOKEN,
  isRegulatoryDocumentReader,
  type IInvoiceService,
  type InvoicingPort,
} from '@openlinker/core/invoicing';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import { ROLE_PERMISSIONS } from '@openlinker/core/users';

import { AuthenticatedUser } from '../../auth/auth.types';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  BENCH_DOCUMENTS_SERVICE_TOKEN,
  type IBenchDocumentsService,
} from '../application/interfaces/bench-documents.service.interface';
import {
  BENCH_PARCEL_SERVICE_TOKEN,
  type IBenchParcelService,
} from '../application/interfaces/bench-parcel.service.interface';
import { BenchParcelNotAtThisBenchError } from '../application/services/bench-parcel.service';
import type {
  BenchDocumentsView,
  BenchUnlabelledParcelListView,
} from '../application/types/bench-parcel.types';
import {
  BenchDocumentsResponseDto,
  BenchUnlabelledParcelListResponseDto,
} from './dto/bench-documents-response.dto';

@ApiBearerAuth()
@ApiTags('bench')
@Controller('bench')
export class BenchDocumentsController {
  constructor(
    @Inject(BENCH_DOCUMENTS_SERVICE_TOKEN)
    private readonly documents: IBenchDocumentsService,
    @Inject(BENCH_PARCEL_SERVICE_TOKEN)
    private readonly parcels: IBenchParcelService,
    @Inject(INVOICE_SERVICE_TOKEN)
    private readonly invoices: IInvoiceService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService
  ) {}

  @Get('work/:workId/documents')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'The paper that belongs with this parcel',
    description:
      'The invoice that goes inside the box and the label that goes on it, each with its own ' +
      'state. A missing invoice is NAMED — in the sales-document vocabulary the rest of the ' +
      'product already uses — and never blocks packing: a tax-rate gap is an office problem the ' +
      'packer cannot fix. A packed parcel with no label is a real state, reported here and on ' +
      'GET /bench/unlabelled-parcels, which dispatch reads too.',
  })
  @ApiResponse({ status: 200, type: BenchDocumentsResponseDto })
  @ApiResponse({ status: 404, description: 'No such parcel at this bench' })
  async getDocuments(
    @Param('workId') workId: string,
    @CurrentUser() user?: AuthenticatedUser
  ): Promise<BenchDocumentsResponseDto> {
    const work = await this.resolveWork(workId);
    const view = await this.documents.getDocuments(work, this.hasShipmentsWrite(user));
    return this.toDto(view);
  }

  @Get('work/:workId/documents/invoice')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: "Print this parcel's invoice",
    description:
      "The rendered document for the parcel's own order — the replacement for the invoicing " +
      'register route a packer may not reach. It creates nothing: the document was issued long ' +
      'before the tote arrived. 409 when the provider produces no printable rendering, which the ' +
      'documents read above reports up front as `issued-not-printable` so a packer is never told ' +
      '"ready to print" and then refused.',
  })
  @ApiProduces('application/pdf', 'text/html')
  @ApiResponse({ status: 200, description: 'Document bytes (Content-Type per provider)' })
  @ApiResponse({ status: 404, description: 'No such parcel, or no issued invoice for its order' })
  @ApiResponse({ status: 409, description: 'The provider cannot produce a printable document' })
  async downloadInvoice(
    @Param('workId') workId: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const work = await this.resolveWork(workId);
    const record = await this.invoices.getLatestIssuedInvoiceForOrder(work.orderId);
    if (record === null) {
      throw new NotFoundException('No issued invoice for this parcel’s order');
    }

    const adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
      record.connectionId,
      'Invoicing'
    );
    if (record.regulatoryStatus !== 'accepted' || !isRegulatoryDocumentReader(adapter)) {
      // Deliberately NOT falling back to the `source` document: that is
      // machine-readable XML, and handing a packer XML to fold into a box is
      // worse than telling them there is nothing to print.
      throw new NotFoundException(
        'This invoice has no printable version. Send the box without it.'
      );
    }

    const document = await adapter.getRegulatoryDocument(record, 'rendered');
    res.setHeader('Content-Type', document.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="invoice-${record.id}"`
    );
    return new StreamableFile(Buffer.from(document.content));
  }

  @Get('unlabelled-parcels')
  @Roles('admin', 'operator', 'packer')
  @ApiOperation({
    summary: 'Finished boxes with no label on them',
    description:
      'Packed and unlabelled — a real state, surfaced to the bench that packed the box AND to ' +
      'whoever runs dispatch, from ONE read so the two can never disagree about a box on a ' +
      'floor. Scoped to this installation’s own packing executor, bounded, and reporting whether ' +
      'it truncated. Carries no carrier prose, because two audiences read it and only one may see ' +
      'that text.',
  })
  @ApiResponse({ status: 200, type: BenchUnlabelledParcelListResponseDto })
  async listUnlabelled(): Promise<BenchUnlabelledParcelListResponseDto> {
    return this.toUnlabelledDto(await this.documents.listUnlabelled());
  }

  /**
   * The parcel, scoped exactly as the parcel read scopes it.
   *
   * Routed through `IBenchParcelService` rather than re-asking the worklist, so
   * "may this session see this parcel" has ONE answer — the same shared
   * eligibility rule story D2 requires, applied to the paperwork as well as to
   * the box.
   */
  private async resolveWork(workId: string): Promise<FulfillmentWorkView> {
    try {
      return await this.parcels.getWorkForDocuments(workId);
    } catch (error) {
      if (
        error instanceof FulfillmentWorkNotFoundError ||
        error instanceof BenchParcelNotAtThisBenchError
      ) {
        throw new NotFoundException('No such parcel at this bench');
      }
      throw error;
    }
  }

  /**
   * May this caller see the carrier's own words?
   *
   * The identical predicate `ShipmentController` applies, and it must stay
   * identical: the raw rejection text may embed address fragments, and a
   * `packer` holds no permissions at all. Fail closed for an unrecognised role
   * — `user.role` arrives verbatim off the JWT with no membership check, so an
   * unknown value indexes to `undefined`.
   */
  private hasShipmentsWrite(user: AuthenticatedUser | undefined): boolean {
    const permissions = user ? ROLE_PERMISSIONS[user.role] : undefined;
    return permissions?.includes('shipments:write') ?? false;
  }

  private toDto(view: BenchDocumentsView): BenchDocumentsResponseDto {
    const invoice = view.invoice;
    const label = view.label;
    // Field by field, never a spread, and the union arms are flattened into one
    // nullable shape so a client reads an explicit `null` rather than an absent
    // key — #939's rule, which is why every field below is always present.
    return {
      workId: view.workId,
      invoice: {
        state: invoice.state,
        invoiceId: invoice.state === 'missing' ? null : invoice.invoiceId,
        documentNumber: invoice.state === 'missing' ? null : invoice.documentNumber,
        issuedAt: invoice.state === 'missing' ? null : invoice.issuedAt,
        blockReason: invoice.state === 'missing' ? invoice.blockReason : null,
        unresolvedReason: invoice.state === 'missing' ? invoice.unresolvedReason : null,
      },
      label: {
        state: label.state,
        shipmentId: label.state === 'none' ? null : label.shipmentId,
        carrier: label.state === 'none' ? null : label.carrier,
        trackingNumber: label.state === 'ready' ? label.trackingNumber : null,
        providerCode: label.state === 'unavailable' ? label.providerCode : null,
        carrierMessage: label.state === 'unavailable' ? label.carrierMessage : null,
        carrierMessageRedacted:
          label.state === 'unavailable' ? label.carrierMessageRedacted : false,
        failedAt: label.state === 'unavailable' ? label.failedAt : null,
      },
    };
  }

  private toUnlabelledDto(
    view: BenchUnlabelledParcelListView
  ): BenchUnlabelledParcelListResponseDto {
    return {
      parcels: view.parcels.map((parcel) => ({
        workId: parcel.workId,
        orderReference: parcel.orderReference,
        parcelIndex: parcel.parcelIndex,
        parcelTotal: parcel.parcelTotal,
        closedAt: parcel.closedAt,
        carrier: parcel.carrier,
        providerCode: parcel.providerCode,
      })),
      total: view.total,
      truncated: view.truncated,
    };
  }
}
