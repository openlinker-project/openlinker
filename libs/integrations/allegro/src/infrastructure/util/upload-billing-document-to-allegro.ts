/**
 * Upload a billing document to an Allegro order (#3549)
 *
 * Two calls, per Allegro's order billing-documents resource: create the
 * invoice entry (`POST /order/checkout-forms/{id}/invoices`, which answers an
 * id), then send the file bytes to it (`PUT .../invoices/{invoiceId}/file`).
 * Allegro allows one document per order and a file of at most 2 MB.
 *
 * Because the two calls are separate, an entry can exist WITHOUT its file: the
 * create landed and the file upload did not. A retry then meets a 409 on create.
 * That 409 is therefore never read as "done" on its own - the entry carrying
 * this document's number is looked up and the file is sent to it. Only a file
 * the marketplace confirms it already holds reads as `already-present`, so a
 * failed file upload can never be recorded as an uploaded document.
 *
 * NOT verified against the sandbox: the endpoint shapes come from Allegro's
 * published announcement and could not be exercised here, so the wire contract
 * is isolated in this one file and every unknown answer is classified toward
 * "retry" rather than "give up".
 *
 * Classification (core records the result; it never sees the message):
 * - 409 on the file upload -> `already-present` (the entry already has a file);
 * - 409 on create -> resume on the existing entry with this number, as above;
 *   an entry with ANOTHER number -> `rejected` (the order holds a different
 *   document, which an operator has to resolve);
 * - 403 -> `rejected` (the application lacks the permission; a retry cannot
 *   grant it);
 * - any other deterministic 4xx -> `rejected`;
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

/** Allegro's documented ceiling for a billing document file. */
export const ALLEGRO_BILLING_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;

/** 401 is a token that can be refreshed; 403 is a missing permission and is not here. */
const TRANSIENT_CLIENT_STATUSES = new Set([401, 408, 429]);

export async function uploadBillingDocumentToAllegro(
  httpClient: IAllegroHttpClient,
  input: UploadBillingDocumentInput
): Promise<UploadBillingDocumentResult> {
  if (input.content.byteLength > ALLEGRO_BILLING_DOCUMENT_MAX_BYTES) {
    return { outcome: 'rejected', detail: 'document-too-large' };
  }

  const base = `/order/checkout-forms/${encodeURIComponent(input.externalOrderId)}/invoices`;
  let invoiceId: string;
  try {
    const created = await httpClient.post<{ id?: unknown }>(base, {
      file: { name: input.fileName },
      invoiceNumber: input.documentNumber,
    });
    const id = created.data?.id;
    if (typeof id !== 'string' || id.length === 0) {
      return { outcome: 'transient-failure', detail: 'create-response-missing-id' };
    }
    invoiceId = id;
  } catch (error) {
    if (statusOf(error) !== 409) return classify(error);
    const existing = await findExistingEntry(httpClient, base, input.documentNumber);
    if ('outcome' in existing) return existing;
    invoiceId = existing.id;
  }

  return sendFile(httpClient, `${base}/${encodeURIComponent(invoiceId)}/file`, input);
}

async function sendFile(
  httpClient: IAllegroHttpClient,
  path: string,
  input: UploadBillingDocumentInput
): Promise<UploadBillingDocumentResult> {
  try {
    await httpClient.putBinary(path, input.contentType, input.content);
    return { outcome: 'uploaded' };
  } catch (error) {
    // The entry already carries a file: the document is on the order.
    if (statusOf(error) === 409) return { outcome: 'already-present' };
    return classify(error);
  }
}

/**
 * Find the entry a previous attempt created for this document number. Anything
 * that does not positively identify it is a retry, never a success.
 */
async function findExistingEntry(
  httpClient: IAllegroHttpClient,
  base: string,
  documentNumber: string
): Promise<{ id: string } | UploadBillingDocumentResult> {
  let entries: Array<{ id: string; invoiceNumber: string | null }>;
  try {
    const listed = await httpClient.get<{ invoices?: unknown }>(base);
    entries = readEntries(listed.data?.invoices);
  } catch (error) {
    return classify(error);
  }

  const ours = entries.find((entry) => entry.invoiceNumber === documentNumber);
  if (ours !== undefined) return { id: ours.id };
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
  return { outcome: 'transient-failure', detail: status !== undefined ? `HTTP ${status}` : 'transport' };
}
