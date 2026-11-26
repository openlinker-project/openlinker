/**
 * Mirakl Order Document Uploader: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { UploadBillingDocumentInput } from '@openlinker/core/orders';
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklNetworkException } from '../../../domain/exceptions/mirakl-network.exception';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { MiraklOrderDocumentUploader } from '../mirakl-order-document-uploader';

const INPUT: UploadBillingDocumentInput = {
  externalOrderId: '1001-A',
  documentNumber: 'FV/1/2026',
  fileName: 'FV-1-2026',
  contentType: 'application/pdf',
  content: new Uint8Array([37, 80, 68, 70]),
};

function setup(existing: unknown[] = []): {
  uploader: MiraklOrderDocumentUploader;
  get: jest.Mock;
  postFile: jest.Mock;
} {
  const get = jest.fn().mockResolvedValue({ status: 200, data: { order_documents: existing } });
  const postFile = jest
    .fn()
    .mockResolvedValue({ status: 200, data: { errors_count: 0, order_documents: [{}] } });
  const client = { get, postFile } as unknown as IMiraklHttpClient;
  return {
    uploader: new MiraklOrderDocumentUploader('conn-1', client, 'Empik', 'CUSTOMER_INVOICE'),
    get,
    postFile,
  };
}

describe('MiraklOrderDocumentUploader', () => {
  it('should upload the invoice as the operator invoice type with a .pdf name', async () => {
    const { uploader, get, postFile } = setup();

    expect(await uploader.uploadBillingDocument(INPUT)).toEqual({ outcome: 'uploaded' });
    expect(get).toHaveBeenCalledWith('/api/orders/documents', {
      queryParams: { order_ids: '1001-A' },
    });
    expect(postFile).toHaveBeenCalledWith('/api/orders/1001-A/documents', {
      fieldName: 'files',
      fileName: 'FV-1-2026.pdf',
      contentType: 'application/pdf',
      content: INPUT.content,
      fields: {
        order_documents: JSON.stringify({
          order_documents: [{ file_name: 'FV-1-2026.pdf', type_code: 'CUSTOMER_INVOICE' }],
        }),
      },
    });
  });

  it('should answer already-present when an earlier upload landed', async () => {
    const { uploader, postFile } = setup([
      { order_id: '1001-A', file_name: 'FV-1-2026.pdf', type: 'CUSTOMER_INVOICE' },
    ]);

    expect(await uploader.uploadBillingDocument(INPUT)).toEqual({ outcome: 'already-present' });
    expect(postFile).not.toHaveBeenCalled();
  });

  it('should reject a file Mirakl reports as an error despite a 200', async () => {
    const { uploader, postFile } = setup();
    postFile.mockResolvedValueOnce({
      status: 200,
      data: { errors_count: 1, document_errors: [{ code: 'INVALID_FILE' }] },
    });

    expect(await uploader.uploadBillingDocument(INPUT)).toEqual({
      outcome: 'rejected',
      detail: 'Empik refused invoice FV/1/2026: INVALID_FILE',
    });
  });

  it('should reject on a Mirakl refusal and report a transport failure as transient', async () => {
    const refused = setup();
    refused.postFile.mockRejectedValueOnce(new MiraklApiException('x', 404, 'ORDER_NOT_FOUND'));
    expect((await refused.uploader.uploadBillingDocument(INPUT)).outcome).toBe('rejected');

    const down = setup();
    down.postFile.mockRejectedValueOnce(new MiraklNetworkException('timeout'));
    expect((await down.uploader.uploadBillingDocument(INPUT)).outcome).toBe('transient-failure');
  });
});
