/**
 * Upload a billing document to an Allegro order (#3549)
 *
 * Two calls, per Allegro's order billing-documents resource: create the
 * invoice entry (`POST /order/checkout-forms/{id}/invoices`, which answers an
 * id), then send the file bytes to it (`PUT .../invoices/{invoiceId}/file`).
 * Allegro allows one document per order and a file of at most 2 MB.
 *
 * NOT verified against the sandbox: the endpoint shapes come from Allegro's
 * published announcement and could not be exercised here, so the wire contract
 * is isolated in this one file and every unknown answer is classified toward
 * "retry" rather than "give up".
 *
 * Classification (core records the result; it never sees the message):
 * - 409 on create, or a 422 reporting an existing document -> `already-present`;
 * - any other deterministic 4xx -> `rejected` (a retry cannot change it);
 * - 401/403/408/429, every 5xx and a transport failure -> `transient-failure`.
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

const TRANSIENT_CLIENT_STATUSES = new Set([401, 403, 408, 429]);

export async function uploadBillingDocumentToAllegro(
  httpClient: IAllegroHttpClient,
  input: UploadBillingDocumentInput
): Promise<UploadBillingDocumentResult> {
  if (input.content.byteLength > ALLEGRO_BILLING_DOCUMENT_MAX_BYTES) {
    return { outcome: 'rejected', detail: 'document-too-large' };
  }

  const base = `/order/checkout-forms/${encodeURIComponent(input.externalOrderId)}/invoices`;
  try {
    const created = await httpClient.post<{ id?: unknown }>(base, {
      file: { name: input.fileName },
      invoiceNumber: input.documentNumber,
    });
    const invoiceId = created.data?.id;
    if (typeof invoiceId !== 'string' || invoiceId.length === 0) {
      return { outcome: 'transient-failure', detail: 'create-response-missing-id' };
    }
    await httpClient.putBinary(
      `${base}/${encodeURIComponent(invoiceId)}/file`,
      input.contentType,
      input.content
    );
    return { outcome: 'uploaded' };
  } catch (error) {
    return classify(error);
  }
}

function classify(error: unknown): UploadBillingDocumentResult {
  const status = error instanceof AllegroApiException ? error.statusCode : undefined;
  if (status === 409) return { outcome: 'already-present' };
  if (status !== undefined && status >= 400 && status < 500) {
    if (TRANSIENT_CLIENT_STATUSES.has(status)) {
      return { outcome: 'transient-failure', detail: `HTTP ${status}` };
    }
    return { outcome: 'rejected', detail: `HTTP ${status}` };
  }
  return { outcome: 'transient-failure', detail: status !== undefined ? `HTTP ${status}` : 'transport' };
}
