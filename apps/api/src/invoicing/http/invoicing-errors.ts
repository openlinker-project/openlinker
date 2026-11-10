/**
 * Invoicing errors (#3864)
 *
 * The coded HTTP errors the invoicing controller sends. Each carries a stable
 * code and the values the frontend's copy needs (ADR-081); `message` stays the
 * English sentence the endpoint always sent, for developers and logs. No
 * provider or buyer text ever goes into a body here: rejections keep their
 * closed `failureCode`, everything else is logged with a correlation id.
 *
 * @module apps/api/src/invoicing/http
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import type { ApiErrorParams } from '@openlinker/shared/errors';
import { codedHttpError } from '../../common/errors/coded-http.exception';
import type {
  InvoiceDataInvalidReason,
  InvoiceDocumentUnavailableReason,
} from './invoicing-errors.types';

export function invoiceNotFound(invoiceId: string): HttpException {
  return codedHttpError(HttpStatus.NOT_FOUND, 'INVOICE_NOT_FOUND', `Invoice not found: ${invoiceId}`, {
    invoiceId,
  });
}

export function orderNotFound(orderId: string): HttpException {
  return codedHttpError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', `Order not found: ${orderId}`, {
    orderId,
  });
}

/** The provider for a connection does not offer an optional capability. */
export function providerCapabilityUnsupported(
  capability: string,
  message: string,
  connectionId: string
): HttpException {
  return codedHttpError(
    HttpStatus.NOT_IMPLEMENTED,
    'PROVIDER_CAPABILITY_UNSUPPORTED',
    message,
    { capability, connectionId }
  );
}

export function invoicingProviderUnavailable(): HttpException {
  return codedHttpError(
    HttpStatus.BAD_GATEWAY,
    'INVOICING_PROVIDER_UNAVAILABLE',
    'Invoicing provider is unavailable'
  );
}

export function invoiceNotFullyIssued(
  invoiceId: string,
  missing: 'provider-invoice-id' | 'document-number',
  message: string
): HttpException {
  return codedHttpError(HttpStatus.UNPROCESSABLE_ENTITY, 'INVOICE_NOT_FULLY_ISSUED', message, {
    invoiceId,
    missing,
  });
}

/** The document file cannot be served. `details` carries `kind`, `status` ... where known. */
export function invoiceDocumentUnavailable(
  invoiceId: string,
  reason: InvoiceDocumentUnavailableReason,
  message: string,
  details: ApiErrorParams = {}
): HttpException {
  return codedHttpError(HttpStatus.CONFLICT, 'INVOICE_DOCUMENT_UNAVAILABLE', message, {
    invoiceId,
    reason,
    ...details,
  });
}

/** The document data is refused. The message comes from OpenLinker's own mappers, never a provider. */
export function invoiceDataInvalid(
  reason: InvoiceDataInvalidReason,
  message: string,
  details: ApiErrorParams = {}
): HttpException {
  return codedHttpError(HttpStatus.BAD_REQUEST, 'INVOICE_DATA_INVALID', message, {
    reason,
    ...details,
  });
}
