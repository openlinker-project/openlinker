/**
 * OrderDocumentEmailService tests (#3550)
 *
 * The cases are the ones the issue names (a send with a resolvable document, an
 * edited recipient, a manual send with buyer emails off, an actionable refusal
 * when nothing is resolvable) plus the ones that keep it safe: provider first but
 * never at the operator's expense, no mailer fallback after a provider failure,
 * and a refusal that never carries a raw error.
 */
import type { ModuleRef } from '@nestjs/core';
import type { EmailMessage } from '@openlinker/core/users';
import type { InvoiceRecord } from '@openlinker/core/invoicing';
import type { FiscalRegistrationRecord } from '@openlinker/core/fiscalization';
import { FiscalRegistrationRecordNotFoundException } from '@openlinker/core/fiscalization';
import { MAILER_TOKEN } from '@openlinker/core/users';
import { OrderDocumentEmailService } from './order-document-email.service';

const ORDER_ID = 'ol_order_1';
const BUYER = 'buyer@example.com';

const invoice = (overrides: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  ({
    id: 'inv-1',
    orderId: ORDER_ID,
    connectionId: 'conn-1',
    status: 'issued',
    providerInvoiceId: 'ext-1',
    providerInvoiceNumber: 'FV/1/2026',
    documentNumber: null,
    ...overrides,
  }) as unknown as InvoiceRecord;

const registration = (overrides: Partial<FiscalRegistrationRecord> = {}): FiscalRegistrationRecord =>
  ({
    id: 'reg-1',
    orderId: ORDER_ID,
    status: 'registered',
    documentReference: 'R/1',
    registeredAt: new Date('2026-10-27T10:00:00Z'),
    artefacts: [
      { medium: 'link', disposition: 'send', content: 'https://eparagony.test/r/1', contentType: null, label: null },
    ],
    ...overrides,
  }) as unknown as FiscalRegistrationRecord;

describe('OrderDocumentEmailService', () => {
  let invoices: { getInvoiceById: jest.Mock };
  let attachments: { resolveAttachment: jest.Mock };
  let fiscal: { getById: jest.Mock };
  let orderRecords: { getOrderRecord: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock };
  let deliveries: { record: jest.Mock };
  let mailer: { sendEmail: jest.Mock } | null;
  let moduleRef: { get: jest.Mock };
  let service: OrderDocumentEmailService;
  const sentMessage = (): EmailMessage =>
    (mailer!.sendEmail.mock.calls as [EmailMessage][])[0][0];

  beforeEach(() => {
    invoices = { getInvoiceById: jest.fn().mockResolvedValue(invoice()) };
    attachments = {
      resolveAttachment: jest
        .fn()
        .mockResolvedValue({ state: 'pdf', content: new Uint8Array([1, 2]), contentType: 'application/pdf' }),
    };
    fiscal = { getById: jest.fn().mockResolvedValue(registration()) };
    orderRecords = { getOrderRecord: jest.fn().mockResolvedValue({ buyerEmail: BUYER }) };
    // A provider with no email capability by default (KSeF / Subiekt shape).
    integrations = { getCapabilityAdapter: jest.fn().mockResolvedValue({}) };
    deliveries = { record: jest.fn().mockResolvedValue(null) };
    mailer = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === MAILER_TOKEN && mailer) return mailer;
        throw new Error('not bound');
      }),
    };
    service = new OrderDocumentEmailService(
      invoices as never,
      attachments as never,
      fiscal as never,
      orderRecords as never,
      integrations as never,
      deliveries as never,
      moduleRef as unknown as ModuleRef
    );
  });

  describe('sendInvoiceEmail', () => {
    it('should send the resolved PDF through the mailer for a provider without its own email', async () => {
      const result = await service.sendInvoiceEmail({ invoiceId: 'inv-1', actorUserId: 'u1' });

      expect(result).toEqual({ status: 'sent', sentVia: 'openlinker', recipient: BUYER });
      const message = sentMessage();
      expect(message.to).toBe(BUYER);
      expect(message.subject).toContain('FV/1/2026');
      expect(message.attachments).toEqual([
        expect.objectContaining({ contentType: 'application/pdf', filename: 'invoice-FV-1-2026.pdf' }),
      ]);
      expect(deliveries.record).toHaveBeenCalledWith(
        expect.objectContaining({
          internalOrderId: ORDER_ID,
          documentKind: 'invoice',
          sentVia: 'openlinker',
          outcome: 'sent',
          actorUserId: 'u1',
        })
      );
    });

    it('should put a link in the body, and no attachment, when only a link exists', async () => {
      attachments.resolveAttachment.mockResolvedValue({ state: 'link', url: 'https://ksef.test/v/1' });

      await service.sendInvoiceEmail({ invoiceId: 'inv-1' });

      const message = sentMessage();
      expect(message.text).toContain('https://ksef.test/v/1');
      expect(message.attachments).toBeUndefined();
    });

    it('should send to an edited recipient through the mailer, never through the provider', async () => {
      const sendByEmail = jest.fn();
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail });

      const result = await service.sendInvoiceEmail({
        invoiceId: 'inv-1',
        recipient: 'accounting@example.com',
      });

      expect(sendByEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'sent',
        sentVia: 'openlinker',
        recipient: 'accounting@example.com',
      });
    });

    it('should use the provider first when it can send and the address is unchanged', async () => {
      const sendByEmail = jest.fn().mockResolvedValue({ delivered: true, recipient: BUYER });
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail });

      const result = await service.sendInvoiceEmail({ invoiceId: 'inv-1', locale: 'pl', sendCopy: true });

      expect(sendByEmail).toHaveBeenCalledWith({
        externalInvoiceId: 'ext-1',
        locale: 'pl',
        sendCopy: true,
      });
      expect(result).toEqual({ status: 'sent', sentVia: 'provider', recipient: BUYER });
      expect(mailer!.sendEmail).not.toHaveBeenCalled();
    });

    it('should treat an unchanged address typed in another case as unchanged', async () => {
      const sendByEmail = jest.fn().mockResolvedValue({ delivered: true, recipient: null });
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail });

      await service.sendInvoiceEmail({ invoiceId: 'inv-1', recipient: 'BUYER@example.com' });

      expect(sendByEmail).toHaveBeenCalled();
    });

    it('should not fall back to the mailer after a provider failure, and never expose its message', async () => {
      const sendByEmail = jest.fn().mockRejectedValue(new Error('smtp://user:secret@host refused'));
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail });

      const result = await service.sendInvoiceEmail({ invoiceId: 'inv-1' });

      expect(mailer!.sendEmail).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'refused', reason: 'send-failed' });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(deliveries.record).toHaveBeenCalledWith(
        expect.objectContaining({ sentVia: 'provider', outcome: 'failed', failureReason: 'send-failed' })
      );
    });

    it('should not write a buyer address from a provider error into the log', async () => {
      const { Logger } = await import('@openlinker/shared/logging');
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const sendByEmail = jest.fn().mockRejectedValue(new Error('inFakt 500: buyer bob@secret.pl'));
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail });

      await service.sendInvoiceEmail({ invoiceId: 'inv-1' });

      expect(errorSpy).toHaveBeenCalledWith(expect.not.stringContaining('bob@secret.pl'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[redacted-email]'));
      errorSpy.mockRestore();
    });

    it('should send a manual email regardless of the connection\'s automatic buyer emails (D6)', async () => {
      // The service never reads a connection's config: asserted by what it was given.
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalledWith(
        expect.anything(),
        'Mailer'
      );

      const result = await service.sendInvoiceEmail({ invoiceId: 'inv-1' });

      expect(result.status).toBe('sent');
    });

    it('should refuse with an actionable message when no document can be resolved', async () => {
      attachments.resolveAttachment.mockResolvedValue({ state: 'none' });

      const result = await service.sendInvoiceEmail({ invoiceId: 'inv-1' });

      expect(result).toMatchObject({ status: 'refused', reason: 'no-document' });
      expect((result as { message: string }).message).toMatch(/no document to attach/i);
      expect(mailer!.sendEmail).not.toHaveBeenCalled();
      expect(deliveries.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failed', failureReason: 'no-document' })
      );
    });

    it('should refuse a document that is not cleared yet as not ready', async () => {
      attachments.resolveAttachment.mockResolvedValue({ state: 'waiting' });

      expect(await service.sendInvoiceEmail({ invoiceId: 'inv-1' })).toMatchObject({
        reason: 'document-not-ready',
      });
    });

    it('should refuse an invoice that was not fully issued', async () => {
      invoices.getInvoiceById.mockResolvedValue(invoice({ status: 'pending' }));

      expect(await service.sendInvoiceEmail({ invoiceId: 'inv-1' })).toMatchObject({
        reason: 'not-issued',
      });
    });

    it('should report an unknown invoice without recording anything', async () => {
      invoices.getInvoiceById.mockResolvedValue(null);

      expect(await service.sendInvoiceEmail({ invoiceId: 'x' })).toMatchObject({
        reason: 'document-not-found',
      });
      expect(deliveries.record).not.toHaveBeenCalled();
    });

    it('should let the provider send when the order carries no buyer address', async () => {
      orderRecords.getOrderRecord.mockResolvedValue({ buyerEmail: undefined });
      const sendByEmail = jest.fn().mockResolvedValue({ delivered: true, recipient: null });
      integrations.getCapabilityAdapter.mockResolvedValue({ sendByEmail });

      const result = await service.sendInvoiceEmail({ invoiceId: 'inv-1' });

      expect(sendByEmail).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: 'sent', sentVia: 'provider', recipient: null });
      expect(mailer!.sendEmail).not.toHaveBeenCalled();
    });

    it('should ask for a recipient when the order carries no buyer address', async () => {
      orderRecords.getOrderRecord.mockResolvedValue({ buyerEmail: undefined });

      expect(await service.sendInvoiceEmail({ invoiceId: 'inv-1' })).toMatchObject({
        reason: 'no-recipient',
      });
    });

    it('should accept an explicit recipient when the order carries none', async () => {
      orderRecords.getOrderRecord.mockResolvedValue({ buyerEmail: undefined });

      const result = await service.sendInvoiceEmail({
        invoiceId: 'inv-1',
        recipient: 'typed@example.com',
      });

      expect(result).toMatchObject({ status: 'sent', recipient: 'typed@example.com' });
    });

    it.each(['not-an-email', 'a@example.com, b@example.com'])(
      'should refuse the recipient "%s" server-side',
      async (recipient) => {
        expect(await service.sendInvoiceEmail({ invoiceId: 'inv-1', recipient })).toMatchObject({
          reason: 'invalid-recipient',
        });
        expect(mailer!.sendEmail).not.toHaveBeenCalled();
      }
    );

    it('should refuse, not crash, when this process has no mailer', async () => {
      mailer = null;

      expect(await service.sendInvoiceEmail({ invoiceId: 'inv-1' })).toMatchObject({
        reason: 'mailer-unavailable',
      });
    });

    it('should report a mailer failure as a code, not its message', async () => {
      mailer!.sendEmail.mockRejectedValue(new Error('535 auth failed for user:secret'));

      const result = await service.sendInvoiceEmail({ invoiceId: 'inv-1' });

      expect(result).toMatchObject({ status: 'refused', reason: 'send-failed' });
      expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('should fall through to the mailer when the provider adapter cannot be resolved', async () => {
      integrations.getCapabilityAdapter.mockRejectedValue(new Error('no adapter'));

      expect(await service.sendInvoiceEmail({ invoiceId: 'inv-1' })).toMatchObject({
        status: 'sent',
        sentVia: 'openlinker',
      });
    });
  });

  describe('sendReceiptEmail', () => {
    it('should send OpenLinker\'s summary with the e-receipt link and say it is not the receipt', async () => {
      const result = await service.sendReceiptEmail({ registrationId: 'reg-1', actorUserId: 'u1' });

      expect(result).toEqual({ status: 'sent', sentVia: 'openlinker', recipient: BUYER });
      const message = sentMessage();
      expect(message.text).toContain('https://eparagony.test/r/1');
      expect(message.text).toMatch(/summary is not the receipt/i);
      expect(message.text).toContain('R/1');
      expect(message.attachments).toBeUndefined();
      expect(deliveries.record).toHaveBeenCalledWith(
        expect.objectContaining({ documentKind: 'fiscal-receipt', outcome: 'sent' })
      );
    });

    it('should refuse a registration that is not registered yet', async () => {
      fiscal.getById.mockResolvedValue(registration({ status: 'registering' }));

      expect(await service.sendReceiptEmail({ registrationId: 'reg-1' })).toMatchObject({
        reason: 'document-not-ready',
      });
    });

    it('should refuse a failed registration as not issued', async () => {
      fiscal.getById.mockResolvedValue(registration({ status: 'failed' }));

      expect(await service.sendReceiptEmail({ registrationId: 'reg-1' })).toMatchObject({
        reason: 'not-issued',
      });
    });

    it('should refuse a registration with no e-receipt link', async () => {
      fiscal.getById.mockResolvedValue(registration({ artefacts: [] }));

      expect(await service.sendReceiptEmail({ registrationId: 'reg-1' })).toMatchObject({
        reason: 'no-document',
      });
    });

    it('should report an unknown registration', async () => {
      fiscal.getById.mockRejectedValue(new FiscalRegistrationRecordNotFoundException('reg-1'));

      expect(await service.sendReceiptEmail({ registrationId: 'reg-1' })).toMatchObject({
        reason: 'document-not-found',
      });
    });

    it('should honour an edited recipient', async () => {
      const result = await service.sendReceiptEmail({
        registrationId: 'reg-1',
        recipient: 'other@example.com',
      });

      expect(result).toMatchObject({ status: 'sent', recipient: 'other@example.com' });
    });
  });
});
