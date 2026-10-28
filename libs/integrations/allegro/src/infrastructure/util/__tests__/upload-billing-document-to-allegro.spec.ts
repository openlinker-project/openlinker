/**
 * uploadBillingDocumentToAllegro tests (#3549)
 */
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import type { IAllegroHttpClient } from '../../http/allegro-http-client.interface';
import {
  ALLEGRO_BILLING_DOCUMENT_MAX_BYTES,
  uploadBillingDocumentToAllegro,
} from '../upload-billing-document-to-allegro';

const input = {
  externalOrderId: 'co-1',
  documentNumber: 'FV/1',
  fileName: 'FV-1.pdf',
  contentType: 'application/pdf',
  content: new Uint8Array([1, 2, 3]),
};

interface Fake {
  post: jest.Mock;
  putBinary: jest.Mock;
  get: jest.Mock;
}

const fake = (overrides: Partial<Fake> = {}): Fake => ({
  post: jest.fn().mockResolvedValue({ data: { id: 'inv-9' } }),
  putBinary: jest.fn().mockResolvedValue({ data: {} }),
  get: jest.fn().mockResolvedValue({ data: { invoices: [] } }),
  ...overrides,
});

const conflict = (): jest.Mock => jest.fn().mockRejectedValue(new AllegroApiException('x', 409));
const asClient = (f: Fake): IAllegroHttpClient => f as unknown as IAllegroHttpClient;

describe('uploadBillingDocumentToAllegro', () => {
  it('should create the entry and then send the file', async () => {
    const http = fake();

    expect(await uploadBillingDocumentToAllegro(asClient(http), input)).toEqual({
      outcome: 'uploaded',
    });
    expect(http.post).toHaveBeenCalledWith('/order/checkout-forms/co-1/invoices', {
      file: { name: 'FV-1.pdf' },
      invoiceNumber: 'FV/1',
    });
    expect(http.putBinary).toHaveBeenCalledWith(
      '/order/checkout-forms/co-1/invoices/inv-9/file',
      'application/pdf',
      input.content
    );
  });

  it('should refuse a file over the 2 MB ceiling without calling Allegro', async () => {
    const http = fake();
    const big = { ...input, content: new Uint8Array(ALLEGRO_BILLING_DOCUMENT_MAX_BYTES + 1) };

    expect((await uploadBillingDocumentToAllegro(asClient(http), big)).outcome).toBe('rejected');
    expect(http.post).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'rejected'],
    [422, 'rejected'],
    [401, 'transient-failure'],
    [429, 'transient-failure'],
    [503, 'transient-failure'],
  ])('should map HTTP %i on create to %s', async (status, outcome) => {
    const http = fake({ post: jest.fn().mockRejectedValue(new AllegroApiException('x', status)) });

    expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(outcome);
  });

  it('should treat a transport error as transient', async () => {
    const http = fake({ post: jest.fn().mockRejectedValue(new Error('socket')) });

    expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
      'transient-failure'
    );
  });

  it('should treat a create response without an id as transient', async () => {
    const http = fake({ post: jest.fn().mockResolvedValue({ data: {} }) });

    expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
      'transient-failure'
    );
  });

  describe('an entry left without its file (#3549 review)', () => {
    it('should report a failed file upload as transient, never as uploaded', async () => {
      const http = fake({
        putBinary: jest.fn().mockRejectedValue(new AllegroApiException('x', 503)),
      });

      expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
        'transient-failure'
      );
    });

    it('should send the file to the existing entry when the retry meets a conflict', async () => {
      const http = fake({
        post: conflict(),
        get: jest.fn().mockResolvedValue({
          data: { invoices: [{ id: 'inv-9', invoiceNumber: 'FV/1' }] },
        }),
      });

      expect(await uploadBillingDocumentToAllegro(asClient(http), input)).toEqual({
        outcome: 'uploaded',
      });
      expect(http.get).toHaveBeenCalledWith('/order/checkout-forms/co-1/invoices');
      expect(http.putBinary).toHaveBeenCalledWith(
        '/order/checkout-forms/co-1/invoices/inv-9/file',
        'application/pdf',
        input.content
      );
    });

    it('should report already-present only when the entry already holds its file', async () => {
      const http = fake({
        post: conflict(),
        get: jest.fn().mockResolvedValue({
          data: { invoices: [{ id: 'inv-9', invoiceNumber: 'FV/1' }] },
        }),
        putBinary: conflict(),
      });

      expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
        'already-present'
      );
    });

    it('should reject when the order holds a different document', async () => {
      const http = fake({
        post: conflict(),
        get: jest.fn().mockResolvedValue({
          data: { invoices: [{ id: 'other', invoiceNumber: 'FV/OTHER' }] },
        }),
      });

      expect(await uploadBillingDocumentToAllegro(asClient(http), input)).toEqual({
        outcome: 'rejected',
        detail: 'order-has-another-document',
      });
      expect(http.putBinary).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty list', { data: { invoices: [] } }],
      ['an unreadable list', { data: { unexpected: true } }],
    ])('should retry rather than claim success on a conflict with %s', async (_label, listed) => {
      const http = fake({ post: conflict(), get: jest.fn().mockResolvedValue(listed) });

      expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
        'transient-failure'
      );
      expect(http.putBinary).not.toHaveBeenCalled();
    });

    it('should retry when the existing entries cannot be listed', async () => {
      const http = fake({
        post: conflict(),
        get: jest.fn().mockRejectedValue(new AllegroApiException('x', 503)),
      });

      expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
        'transient-failure'
      );
    });
  });
});
