/**
 * uploadBillingDocumentToAllegro tests (#3549)
 */
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import type {
  AllegroMultipartPart,
  IAllegroHttpClient,
} from '../../http/allegro-http-client.interface';
import {
  ALLEGRO_BILLING_DOCUMENT_MAX_BYTES,
  attachBillingDocumentLinkToAllegro,
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
  postMultipart: jest.Mock;
  get: jest.Mock;
}

const fake = (overrides: Partial<Fake> = {}): Fake => ({
  postMultipart: jest.fn().mockResolvedValue({ data: { id: 'inv-9' } }),
  get: jest.fn().mockResolvedValue({ data: { invoices: [] } }),
  ...overrides,
});

const conflict = (): jest.Mock => jest.fn().mockRejectedValue(new AllegroApiException('x', 409));
const asClient = (f: Fake): IAllegroHttpClient => f as unknown as IAllegroHttpClient;
const sentCall = (f: Fake): [string, AllegroMultipartPart[]] =>
  f.postMultipart.mock.calls[0] as [string, AllegroMultipartPart[]];

describe('uploadBillingDocumentToAllegro', () => {
  it('should send the file and its number in one request', async () => {
    const http = fake();

    expect(await uploadBillingDocumentToAllegro(asClient(http), input)).toEqual({
      outcome: 'uploaded',
    });
    expect(http.postMultipart).toHaveBeenCalledTimes(1);
    const [path, [file, number]] = sentCall(http);
    expect(path).toBe('/order/co-1/billing-documents/files');
    expect(file).toEqual({
      name: 'file',
      fileName: 'FV-1.pdf',
      contentType: 'application/pdf',
      bytes: input.content,
    });
    expect(number.name).toBe('invoiceNumber');
    // A plain form field: a fileName here would make Allegro read it as a second upload.
    expect(number.fileName).toBeUndefined();
    expect(number.contentType).toBe('text/plain; charset=utf-8');
    expect(new TextDecoder().decode(number.bytes)).toBe('FV/1');
  });

  it('should refuse a file over the 3 MB ceiling without calling Allegro', async () => {
    const http = fake();
    const big = { ...input, content: new Uint8Array(ALLEGRO_BILLING_DOCUMENT_MAX_BYTES + 1) };

    expect(await uploadBillingDocumentToAllegro(asClient(http), big)).toEqual({
      outcome: 'rejected',
      detail: 'document-too-large',
    });
    expect(http.postMultipart).not.toHaveBeenCalled();
  });

  it('should accept a PDF whose content type carries a parameter', async () => {
    const http = fake();

    expect(
      await uploadBillingDocumentToAllegro(asClient(http), {
        ...input,
        contentType: 'Application/PDF; charset=binary',
      })
    ).toEqual({ outcome: 'uploaded' });
    expect(sentCall(http)[1][0].contentType).toBe('application/pdf');
  });

  it('should refuse a document that is not a PDF without calling Allegro', async () => {
    const http = fake();

    expect(
      await uploadBillingDocumentToAllegro(asClient(http), { ...input, contentType: 'text/xml' })
    ).toEqual({ outcome: 'rejected', detail: 'document-not-pdf' });
    expect(http.postMultipart).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'rejected'],
    [403, 'rejected'],
    [413, 'rejected'],
    [422, 'rejected'],
    [401, 'transient-failure'],
    [429, 'transient-failure'],
    [503, 'transient-failure'],
  ])('should map HTTP %i to %s', async (status, outcome) => {
    const http = fake({
      postMultipart: jest.fn().mockRejectedValue(new AllegroApiException('x', status)),
    });

    expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(outcome);
  });

  it('should treat a transport error as transient', async () => {
    const http = fake({ postMultipart: jest.fn().mockRejectedValue(new Error('socket')) });

    expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
      'transient-failure'
    );
  });

  it('should treat a response without an id as transient, never as uploaded', async () => {
    const http = fake({ postMultipart: jest.fn().mockResolvedValue({ data: {} }) });

    expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
      'transient-failure'
    );
  });

  describe('a conflict (the order already holds a file)', () => {
    it('should report already-present when the order holds this document', async () => {
      const http = fake({
        postMultipart: conflict(),
        get: jest.fn().mockResolvedValue({
          data: { invoices: [{ id: 'inv-9', invoiceNumber: 'FV/1' }] },
        }),
      });

      expect(await uploadBillingDocumentToAllegro(asClient(http), input)).toEqual({
        outcome: 'already-present',
      });
      expect(http.get).toHaveBeenCalledWith('/order/checkout-forms/co-1/invoices');
    });

    it('should reject when the order holds a different document', async () => {
      const http = fake({
        postMultipart: conflict(),
        get: jest.fn().mockResolvedValue({
          data: { invoices: [{ id: 'other', invoiceNumber: 'FV/OTHER' }] },
        }),
      });

      expect(await uploadBillingDocumentToAllegro(asClient(http), input)).toEqual({
        outcome: 'rejected',
        detail: 'order-has-another-document',
      });
    });

    it.each([
      ['an empty list', { data: { invoices: [] } }],
      ['an unreadable list', { data: { unexpected: true } }],
    ])('should retry rather than claim success on a conflict with %s', async (_label, listed) => {
      const http = fake({ postMultipart: conflict(), get: jest.fn().mockResolvedValue(listed) });

      expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
        'transient-failure'
      );
    });

    it('should retry when the existing documents cannot be listed', async () => {
      const http = fake({
        postMultipart: conflict(),
        get: jest.fn().mockRejectedValue(new AllegroApiException('x', 503)),
      });

      expect((await uploadBillingDocumentToAllegro(asClient(http), input)).outcome).toBe(
        'transient-failure'
      );
    });
  });
});

describe('attachBillingDocumentLinkToAllegro', () => {
  const linkInput = {
    externalOrderId: 'co-1',
    documentNumber: 'FV/1',
    url: 'https://eparagony.pl/r/123',
  };
  const linkClient = (post: jest.Mock): IAllegroHttpClient =>
    ({ post }) as unknown as IAllegroHttpClient;

  it('should send the url as JSON to the links resource', async () => {
    const post = jest.fn().mockResolvedValue({ data: undefined });

    expect(await attachBillingDocumentLinkToAllegro(linkClient(post), linkInput)).toEqual({
      outcome: 'uploaded',
    });
    expect(post).toHaveBeenCalledWith('/order/co-1/billing-documents/links', {
      url: 'https://eparagony.pl/r/123',
    });
  });

  it('should read a 409 as the same url already on the order', async () => {
    const post = jest.fn().mockRejectedValue(new AllegroApiException('x', 409));

    expect(await attachBillingDocumentLinkToAllegro(linkClient(post), linkInput)).toEqual({
      outcome: 'already-present',
    });
  });

  it('should read a 422 as a link Allegro will not take, which no retry changes', async () => {
    const post = jest.fn().mockRejectedValue(new AllegroApiException('x', 422));

    expect(await attachBillingDocumentLinkToAllegro(linkClient(post), linkInput)).toEqual({
      outcome: 'unsupported',
      detail: 'link-not-accepted',
    });
  });

  it.each([
    [403, 'rejected'],
    [404, 'rejected'],
    [401, 'transient-failure'],
    [429, 'transient-failure'],
    [503, 'transient-failure'],
  ])('should map HTTP %i to %s', async (status, outcome) => {
    const post = jest.fn().mockRejectedValue(new AllegroApiException('x', status));

    expect((await attachBillingDocumentLinkToAllegro(linkClient(post), linkInput)).outcome).toBe(
      outcome
    );
  });
});
