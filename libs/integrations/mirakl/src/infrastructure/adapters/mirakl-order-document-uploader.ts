/**
 * Mirakl Order Document Uploader
 *
 * The `OrderBillingDocumentUploader` half of the Mirakl order source (#4276):
 * attaches an issued invoice to the order through OR74
 * (`POST /api/orders/{id}/documents`), as the operator's invoice document type
 * (Empik: `CUSTOMER_INVOICE`, read from DO01 on staging).
 *
 * OR74 is a file upload, which the client never retries on a transport
 * failure, and Mirakl keeps a second copy if the same file is sent twice. So
 * every upload first reads the order's documents (OR72,
 * `GET /api/orders/documents`): a document of the invoice type with the same
 * file name means an earlier attempt landed, and the answer is
 * `already-present`. That is what makes a retry after a lost answer safe.
 *
 * OR74 answers 200 even when a file is refused, reporting it in
 * `errors_count`; that is `rejected`, never `uploaded`.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 * @implements {OrderBillingDocumentUploader}
 */
import type {
  OrderBillingDocumentUploader,
  UploadBillingDocumentInput,
  UploadBillingDocumentResult,
} from '@openlinker/core/orders';
import { Logger } from '@openlinker/shared/logging';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { MiraklNetworkException } from '../../domain/exceptions/mirakl-network.exception';
import { MiraklRateLimitException } from '../../domain/exceptions/mirakl-rate-limit.exception';
import type {
  MiraklDocumentUploadResult,
  MiraklOrderDocument,
} from '../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';
import { describeMiraklFailure, miraklOrderPath } from './mirakl-order-reader';

const ORDER_DOCUMENTS_PATH = '/api/orders/documents';
const PDF_CONTENT_TYPE = 'application/pdf';

export class MiraklOrderDocumentUploader implements OrderBillingDocumentUploader {
  private readonly logger = new Logger(MiraklOrderDocumentUploader.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IMiraklHttpClient,
    private readonly brand: string,
    private readonly invoiceTypeCode: string
  ) {}

  async uploadBillingDocument(
    input: UploadBillingDocumentInput
  ): Promise<UploadBillingDocumentResult> {
    const fileName = withPdfExtension(input.fileName, input.contentType);
    try {
      if (await this.alreadyHolds(input.externalOrderId, fileName)) {
        return { outcome: 'already-present' };
      }
      const { data } = await this.httpClient.postFile<MiraklDocumentUploadResult>(
        miraklOrderPath(input.externalOrderId, 'documents'),
        {
          fieldName: 'files',
          fileName,
          contentType: input.contentType,
          content: input.content,
          fields: {
            order_documents: JSON.stringify({
              order_documents: [{ file_name: fileName, type_code: this.invoiceTypeCode }],
            }),
          },
        }
      );
      if ((data?.errors_count ?? 0) > 0) {
        const code = data?.document_errors?.[0]?.code;
        return {
          outcome: 'rejected',
          detail: `${this.brand} refused invoice ${input.documentNumber}${code ? `: ${code}` : ''}`,
        };
      }
      return { outcome: 'uploaded' };
    } catch (error) {
      if (error instanceof MiraklApiException) {
        return {
          outcome: 'rejected',
          detail: `${this.brand} refused invoice ${input.documentNumber}: ${describeMiraklFailure(
            error.statusCode,
            error.miraklCode
          )}`,
        };
      }
      if (error instanceof MiraklNetworkException || error instanceof MiraklRateLimitException) {
        this.logger.warn(
          `Invoice upload for order ${input.externalOrderId} on connection ${this.connectionId} did not settle: ${error.name}`
        );
        return {
          outcome: 'transient-failure',
          detail: `${this.brand} did not answer the invoice upload; it will be retried`,
        };
      }
      throw error;
    }
  }

  private async alreadyHolds(orderId: string, fileName: string): Promise<boolean> {
    const { data } = await this.httpClient.get<{
      order_documents?: readonly MiraklOrderDocument[];
    }>(ORDER_DOCUMENTS_PATH, { queryParams: { order_ids: orderId } });
    return (data?.order_documents ?? []).some(
      (document) =>
        document.type === this.invoiceTypeCode &&
        document.file_name === fileName &&
        (document.order_id === undefined || document.order_id === orderId)
    );
  }
}

/** Mirakl checks the extension against the document type's MIME list. */
function withPdfExtension(fileName: string, contentType: string): string {
  if (contentType !== PDF_CONTENT_TYPE || /\.pdf$/i.test(fileName)) {
    return fileName;
  }
  return `${fileName.replace(/\.[^./]*$/, '')}.pdf`;
}
