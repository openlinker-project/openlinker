/**
 * Upload a billing document to an Allegro order (#3549)
 *
 * One call: `POST /order/{orderId}/billing-documents/files`, a
 * `multipart/form-data` body carrying the PDF (`file`) and its number
 * (`invoiceNumber`), answering `201 {id}` (`uploadOrderInvoiceFileWithMetadata`
 * in Allegro's OpenAPI spec). It replaces the two-step flow (create the entry,
 * then PUT its file), which Allegro marked deprecated on 2026-10-05; using it
 * also removes the state where an entry exists without its file.
 *
 * NOT verified against the sandbox: the contract is transcribed from Allegro's
 * OpenAPI spec (`uploadOrderInvoiceFileWithMetadata`) and has not been exercised
 * against a live response, so the wire contract is isolated in this one file and
 * every unknown answer is classified toward "retry" rather than "give up".
 *
 * Allegro accepts a PDF only, of at most 3 MB; both are checked before the call
 * so a document that can never be accepted costs no request. Only the media type
 * is compared, so a parameterised `application/pdf; ...` is still a PDF.
 *
 * An order may hold several invoices (Allegro caps the count with a 422), so a
 * different document already on the order does not by itself block an upload;
 * only a 409 sends us to the listing below.
 *
 * A 409 means the order already holds a file with this name, or already holds
 * an invoice file. That alone does not say WHOSE file it is, so the order's
 * documents are listed (`GET /order/checkout-forms/{id}/invoices`, not
 * deprecated): an entry carrying this document's number is `already-present`
 * (a retry after a lost answer to our own upload), any other entry is
 * `rejected` (the order holds a different document, which an operator has to
 * resolve), and an answer that identifies nothing is a retry, never a success.
 *
 * `postMultipart` never auto-retries an ambiguous failure, so a lost answer is
 * retried by the job, which meets the 409 above rather than uploading twice.
 *
 * Classification (core records the result; it never sees the message):
 * - 409 -> resolved by listing, as above;
 * - 403 -> `rejected` (the application lacks the permission; a retry cannot
 *   grant it);
 * - 400 / 413 / 422 and any other deterministic 4xx -> `rejected`;
 * - 401/408/429, every 5xx, a transport failure and an unreadable answer ->
 *   `transient-failure`.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 */
import type {
  UploadBillingDocumentInput,
  UploadBillingDocumentResult,
} from '@openlinker/core/orders';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';

/** Allegro's documented ceiling for a billing document file (413 above it). */
export const ALLEGRO_BILLING_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;

/** The only file type Allegro accepts on this resource. */
const ALLEGRO_BILLING_DOCUMENT_CONTENT_TYPE = 'application/pdf';

/** 401 is a token that can be refreshed; 403 is a missing permission and is not here. */
const TRANSIENT_CLIENT_STATUSES = new Set([401, 408, 429]);

export async function uploadBillingDocumentToAllegro(
  httpClient: IAllegroHttpClient,
  input: UploadBillingDocumentInput
): Promise<UploadBillingDocumentResult> {
  if (mediaTypeOf(input.contentType) !== ALLEGRO_BILLING_DOCUMENT_CONTENT_TYPE) {
    return { outcome: 'rejected', detail: 'document-not-pdf' };
  }
  if (input.content.byteLength > ALLEGRO_BILLING_DOCUMENT_MAX_BYTES) {
    return { outcome: 'rejected', detail: 'document-too-large' };
  }

  const orderId = encodeURIComponent(input.externalOrderId);
  try {
    const created = await httpClient.postMultipart<{ id?: unknown }>(
      `/order/${orderId}/billing-documents/files`,
      [
        {
          name: 'file',
          fileName: input.fileName,
          contentType: ALLEGRO_BILLING_DOCUMENT_CONTENT_TYPE,
          bytes: input.content,
        },
        {
          name: 'invoiceNumber',
          contentType: 'text/plain; charset=utf-8',
          bytes: new TextEncoder().encode(input.documentNumber),
        },
      ]
    );
    const id = created.data?.id;
    if (typeof id !== 'string' || id.length === 0) {
      return { outcome: 'transient-failure', detail: 'upload-response-missing-id' };
    }
    return { outcome: 'uploaded' };
  } catch (error) {
    if (statusOf(error) !== 409) return classify(error);
    return resolveConflict(
      httpClient,
      `/order/checkout-forms/${orderId}/invoices`,
      input.documentNumber
    );
  }
}

/**
 * Decide what a 409 means by finding the document this order already holds.
 * Anything that does not positively identify ours is a retry, never a success.
 */
async function resolveConflict(
  httpClient: IAllegroHttpClient,
  listPath: string,
  documentNumber: string
): Promise<UploadBillingDocumentResult> {
  let entries: Array<{ id: string; invoiceNumber: string | null }>;
  try {
    const listed = await httpClient.get<{ invoices?: unknown }>(listPath);
    entries = readEntries(listed.data?.invoices);
  } catch (error) {
    return classify(error);
  }

  if (entries.some((entry) => entry.invoiceNumber === documentNumber)) {
    return { outcome: 'already-present' };
  }
  if (entries.length > 0) return { outcome: 'rejected', detail: 'order-has-another-document' };
  // A conflict with nothing listed is an answer this file does not understand.
  return { outcome: 'transient-failure', detail: 'conflict-without-entry' };
}

function readEntries(value: unknown): Array<{ id: string; invoiceNumber: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== 'object') return [];
    const { id, invoiceNumber } = entry as { id?: unknown; invoiceNumber?: unknown };
    if (typeof id !== 'string' || id.length === 0) return [];
    return [{ id, invoiceNumber: typeof invoiceNumber === 'string' ? invoiceNumber : null }];
  });
}

/** `application/PDF; charset=binary` -> `application/pdf`: parameters say nothing about the type. */
function mediaTypeOf(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

function statusOf(error: unknown): number | undefined {
  return error instanceof AllegroApiException ? error.statusCode : undefined;
}

function classify(error: unknown): UploadBillingDocumentResult {
  const status = statusOf(error);
  if (status !== undefined && status >= 400 && status < 500) {
    if (TRANSIENT_CLIENT_STATUSES.has(status)) {
      return { outcome: 'transient-failure', detail: `HTTP ${status}` };
    }
    return { outcome: 'rejected', detail: status === 403 ? 'forbidden' : `HTTP ${status}` };
  }
  return {
    outcome: 'transient-failure',
    detail: status !== undefined ? `HTTP ${status}` : 'transport',
  };
}
