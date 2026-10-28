/**
 * Order Document Email Service (#3550, epic #3510)
 *
 * See {@link IOrderDocumentEmailService} for the five properties this rests on.
 * The file carries only what is specific to the code.
 *
 * `MAILER_TOKEN` is bound in `apps/api` only, and `OrdersModule` is also imported
 * by the worker, so the mailer is resolved lazily through `ModuleRef` rather than
 * injected: a constructor dependency would stop the worker booting. An absent
 * mailer is a named refusal, never a crash (the automation `send-email` executor
 * handles the same binding gap the same way).
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderDocumentEmailService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Logger } from '@openlinker/shared/logging';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import {
  INVOICE_ATTACHMENT_SERVICE_TOKEN,
  INVOICE_SERVICE_TOKEN,
  IInvoiceAttachmentService,
  IInvoiceService,
  isInvoiceEmailSender,
} from '@openlinker/core/invoicing';
import type { InvoiceRecord, InvoicingPort } from '@openlinker/core/invoicing';
import {
  FISCAL_REGISTRATION_SERVICE_TOKEN,
  FiscalRegistrationRecordNotFoundException,
  IFiscalRegistrationService,
} from '@openlinker/core/fiscalization';
import {
  DOCUMENT_EMAIL_DELIVERY_SERVICE_TOKEN,
  IDocumentEmailDeliveryService,
  normaliseDocumentEmailRecipient,
} from '@openlinker/core/sales-documents';
import type {
  DocumentEmailFailureReason,
  DocumentEmailSentVia,
} from '@openlinker/core/sales-documents';
import { MAILER_TOKEN } from '@openlinker/core/users';
import type { MailerPort } from '@openlinker/core/users';
import {
  ORDER_DOCUMENT_EMAIL_REFUSAL_MESSAGE,
  composeInvoiceEmail,
  composeReceiptEmail,
  invoiceAttachmentFilename,
  scrubEmailAddresses,
  type OrderDocumentEmailRefusal,
} from '../../domain/types/order-document-email.types';
import type {
  IOrderDocumentEmailService,
  OrderDocumentEmailResult,
  SendInvoiceEmailInput,
  SendReceiptEmailInput,
} from '../interfaces/order-document-email.service.interface';
import { IOrderRecordService } from '../interfaces/order-record.service.interface';
import { ORDER_RECORD_SERVICE_TOKEN } from '../../orders.tokens';

const DEFAULT_LOCALE = 'en';

interface AttemptContext {
  internalOrderId: string;
  documentKind: 'invoice' | 'fiscal-receipt';
  documentId: string;
  actorUserId: string | null;
}

@Injectable()
export class OrderDocumentEmailService implements IOrderDocumentEmailService {
  private readonly logger = new Logger(OrderDocumentEmailService.name);

  constructor(
    @Inject(INVOICE_SERVICE_TOKEN) private readonly invoices: IInvoiceService,
    @Inject(INVOICE_ATTACHMENT_SERVICE_TOKEN)
    private readonly attachments: IInvoiceAttachmentService,
    @Inject(FISCAL_REGISTRATION_SERVICE_TOKEN)
    private readonly fiscalRegistrations: IFiscalRegistrationService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN) private readonly orderRecords: IOrderRecordService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN) private readonly integrations: IIntegrationsService,
    @Inject(DOCUMENT_EMAIL_DELIVERY_SERVICE_TOKEN)
    private readonly deliveries: IDocumentEmailDeliveryService,
    private readonly moduleRef: ModuleRef
  ) {}

  async sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<OrderDocumentEmailResult> {
    const record = await this.invoices.getInvoiceById(input.invoiceId);
    if (record === null) return this.refusal('document-not-found');

    const ctx: AttemptContext = {
      internalOrderId: record.orderId,
      documentKind: 'invoice',
      documentId: record.id,
      actorUserId: input.actorUserId ?? null,
    };
    if (record.status !== 'issued') return this.fail(ctx, null, null, 'not-issued');

    const order = await this.orderRecords.getOrderRecord(record.orderId);
    const buyerEmail = order?.buyerEmail ?? null;
    const recipient = this.resolveRecipient(input.recipient, buyerEmail);
    if (recipient.status === 'refused') return this.fail(ctx, null, null, recipient.reason);

    // Provider first - but only while the operator did not change the address,
    // because the provider's mechanism cannot take one (interface, property 1).
    const overridden =
      input.recipient !== undefined &&
      input.recipient.trim().length > 0 &&
      recipient.address.toLowerCase() !== (buyerEmail ?? '').toLowerCase();
    if (!overridden && record.providerInvoiceId) {
      const viaProvider = await this.trySendViaProvider(ctx, record, input, recipient.address);
      if (viaProvider !== null) return viaProvider;
    }

    return this.sendInvoiceViaMailer(ctx, record, input, recipient.address);
  }

  async sendReceiptEmail(input: SendReceiptEmailInput): Promise<OrderDocumentEmailResult> {
    let registration;
    try {
      registration = await this.fiscalRegistrations.getById(input.registrationId);
    } catch (error) {
      if (error instanceof FiscalRegistrationRecordNotFoundException) {
        return this.refusal('document-not-found');
      }
      throw error;
    }

    const ctx: AttemptContext = {
      internalOrderId: registration.orderId,
      documentKind: 'fiscal-receipt',
      documentId: registration.id,
      actorUserId: input.actorUserId ?? null,
    };
    if (registration.status === 'failed') return this.fail(ctx, null, null, 'not-issued');
    if (registration.status !== 'registered') {
      return this.fail(ctx, null, null, 'document-not-ready');
    }

    const link = (registration.artefacts ?? []).find((a) => a.medium === 'link');
    if (!link || link.content.trim().length === 0) return this.fail(ctx, null, null, 'no-document');

    const order = await this.orderRecords.getOrderRecord(registration.orderId);
    const recipient = this.resolveRecipient(input.recipient, order?.buyerEmail ?? null);
    if (recipient.status === 'refused') return this.fail(ctx, null, null, recipient.reason);

    const mailer = this.resolveMailer();
    if (mailer === null) return this.fail(ctx, null, recipient.address, 'mailer-unavailable');

    const composed = composeReceiptEmail({
      locale: input.locale ?? DEFAULT_LOCALE,
      documentReference: registration.documentReference,
      registeredOn: registration.registeredAt
        ? registration.registeredAt.toISOString().slice(0, 10)
        : null,
      link: link.content.trim(),
    });
    return this.deliver(ctx, mailer, 'openlinker', recipient.address, {
      to: recipient.address,
      ...composed,
    });
  }

  /** Recipient given -> validated; else the buyer's stored address -> validated; else refused. */
  private resolveRecipient(
    explicit: string | undefined,
    buyerEmail: string | null
  ):
    | { status: 'ok'; address: string }
    | { status: 'refused'; reason: 'no-recipient' | 'invalid-recipient' } {
    const given = explicit?.trim() ?? '';
    const raw = given.length > 0 ? given : buyerEmail;
    if (raw === null || raw.length === 0) return { status: 'refused', reason: 'no-recipient' };
    const address = normaliseDocumentEmailRecipient(raw);
    return address === null
      ? { status: 'refused', reason: 'invalid-recipient' }
      : { status: 'ok', address };
  }

  /** `null` means "the provider cannot do this here" and the caller falls through to the mailer. */
  private async trySendViaProvider(
    ctx: AttemptContext,
    record: InvoiceRecord,
    input: SendInvoiceEmailInput,
    address: string
  ): Promise<OrderDocumentEmailResult | null> {
    let adapter: InvoicingPort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<InvoicingPort>(
        record.connectionId,
        'Invoicing'
      );
    } catch (error) {
      this.logger.warn(
        `Invoicing adapter unavailable for the provider email path: invoice=${record.id}: ${
          error instanceof Error ? error.name : 'UnknownError'
        }`
      );
      return null;
    }
    if (!isInvoiceEmailSender(adapter) || !record.providerInvoiceId) return null;

    try {
      const result = await adapter.sendByEmail({
        externalInvoiceId: record.providerInvoiceId,
        locale: input.locale,
        sendCopy: input.sendCopy,
      });
      if (!result.delivered) return this.fail(ctx, 'provider', address, 'send-failed');
      const recipient = result.recipient ?? address;
      await this.record(ctx, 'provider', 'sent', null, recipient);
      return { status: 'sent', sentVia: 'provider', recipient };
    } catch (error) {
      // Not retried through the mailer: the provider may have sent it already.
      // Message only, scrubbed, no stack: a provider error can embed the buyer's address.
      this.logger.error(
        `Provider email failed: invoice=${record.id}: ${this.describeError(error)}`
      );
      return this.fail(ctx, 'provider', address, 'send-failed');
    }
  }

  private async sendInvoiceViaMailer(
    ctx: AttemptContext,
    record: InvoiceRecord,
    input: SendInvoiceEmailInput,
    address: string
  ): Promise<OrderDocumentEmailResult> {
    const mailer = this.resolveMailer();
    if (mailer === null) return this.fail(ctx, null, address, 'mailer-unavailable');

    const attachment = await this.attachments.resolveAttachment(record.id);
    if (attachment === null) return this.fail(ctx, null, address, 'no-document');
    if (attachment.state === 'waiting') return this.fail(ctx, null, address, 'document-not-ready');
    if (attachment.state === 'none') return this.fail(ctx, null, address, 'no-document');

    const documentNumber = record.documentNumber ?? record.providerInvoiceNumber;
    const composed = composeInvoiceEmail({
      locale: input.locale ?? DEFAULT_LOCALE,
      documentNumber,
      link: attachment.state === 'link' ? attachment.url : null,
    });
    return this.deliver(ctx, mailer, 'openlinker', address, {
      to: address,
      ...composed,
      ...(attachment.state === 'pdf'
        ? {
            attachments: [
              {
                filename: invoiceAttachmentFilename(documentNumber),
                content: attachment.content,
                contentType: attachment.contentType,
              },
            ],
          }
        : {}),
    });
  }

  private async deliver(
    ctx: AttemptContext,
    mailer: MailerPort,
    sentVia: DocumentEmailSentVia,
    address: string,
    message: Parameters<MailerPort['sendEmail']>[0]
  ): Promise<OrderDocumentEmailResult> {
    try {
      await mailer.sendEmail(message);
    } catch (error) {
      this.logger.error(
        `Mailer failed: ${ctx.documentKind}=${ctx.documentId}: ${this.describeError(error)}`
      );
      return this.fail(ctx, sentVia, address, 'send-failed');
    }
    await this.record(ctx, sentVia, 'sent', null, address);
    return { status: 'sent', sentVia, recipient: address };
  }

  private describeError(error: unknown): string {
    return scrubEmailAddresses(error instanceof Error ? error.message : String(error));
  }

  private resolveMailer(): MailerPort | null {
    try {
      return this.moduleRef.get<MailerPort>(MAILER_TOKEN, { strict: false });
    } catch {
      return null;
    }
  }

  private refusal(reason: OrderDocumentEmailRefusal): OrderDocumentEmailResult {
    return { status: 'refused', reason, message: ORDER_DOCUMENT_EMAIL_REFUSAL_MESSAGE[reason] };
  }

  /** Record a failed attempt, then answer with the refusal. */
  private async fail(
    ctx: AttemptContext,
    sentVia: DocumentEmailSentVia | null,
    recipient: string | null,
    reason: DocumentEmailFailureReason
  ): Promise<OrderDocumentEmailResult> {
    await this.record(ctx, sentVia, 'failed', reason, recipient);
    return this.refusal(reason);
  }

  private async record(
    ctx: AttemptContext,
    sentVia: DocumentEmailSentVia | null,
    outcome: 'sent' | 'failed',
    failureReason: DocumentEmailFailureReason | null,
    recipient: string | null
  ): Promise<void> {
    await this.deliveries.record({
      internalOrderId: ctx.internalOrderId,
      documentKind: ctx.documentKind,
      documentId: ctx.documentId,
      sentVia,
      outcome,
      failureReason,
      recipient,
      actorUserId: ctx.actorUserId,
    });
  }
}
