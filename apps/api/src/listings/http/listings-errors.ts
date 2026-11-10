/**
 * Listings errors (#3865)
 *
 * The coded HTTP errors the listings controllers send. Each carries a stable
 * code and the values the frontend's copy needs (ADR-081); `message` stays the
 * English sentence the endpoint always sent, for developers and logs.
 *
 * @module apps/api/src/listings/http
 */
import { HttpStatus, type HttpException } from '@nestjs/common';
import {
  type AdapterCapabilityNotSupportedException,
  AllVariantsAlreadyListedException,
  CurrencyMismatchException,
  DuplicateBatchEanException,
  EmptyBulkSubmissionException,
  ExpandedOfferCeilingExceededException,
  InvalidEanException,
  InvalidOverrideKeyException,
  type MasterCatalogConnectionNotConfiguredException,
  MasterStockNotSyncedException,
} from '@openlinker/core/listings';
import { codedHttpError } from '../../common/errors/coded-http.exception';

/** The connection's adapter does not offer an optional reader the endpoint needs. */
export function providerCapabilityUnsupported(
  status: number,
  capability: string,
  connectionId: string,
  message: string
): HttpException {
  return codedHttpError(status, 'PROVIDER_CAPABILITY_UNSUPPORTED', message, {
    capability,
    connectionId,
  });
}

export function adapterCapabilityNotSupported(
  error: AdapterCapabilityNotSupportedException,
  status: number
): HttpException {
  return providerCapabilityUnsupported(status, error.capability, error.connectionId, error.message);
}

/** The marketplace connection has no master catalogue set, so product data cannot be read. */
export function masterCatalogConnectionNotConfigured(
  error: MasterCatalogConnectionNotConfiguredException,
  status: number
): HttpException {
  return codedHttpError(status, 'MASTER_CATALOG_CONNECTION_NOT_CONFIGURED', error.message, {
    connectionId: error.marketplaceConnectionId,
  });
}

export function offerMappingNotFound(mappingId: string, message: string): HttpException {
  return codedHttpError(HttpStatus.NOT_FOUND, 'OFFER_MAPPING_NOT_FOUND', message, { mappingId });
}

export function categoryNotFound(categoryId: string, connectionId: string): HttpException {
  return codedHttpError(
    HttpStatus.NOT_FOUND,
    'MARKETPLACE_CATEGORY_NOT_FOUND',
    `Category ${categoryId} not found on connection ${connectionId}`,
    { categoryId, connectionId }
  );
}

export function bulkSubmissionEmpty(error: EmptyBulkSubmissionException): HttpException {
  return codedHttpError(HttpStatus.BAD_REQUEST, 'BULK_SUBMISSION_EMPTY', error.message);
}

/**
 * The bulk offer submission refusals the domain raises before anything is
 * enqueued, or `null` when `error` is not one of them.
 */
export function bulkSubmissionRefusal(error: unknown): HttpException | null {
  if (error instanceof EmptyBulkSubmissionException) {
    return bulkSubmissionEmpty(error);
  }
  if (error instanceof AllVariantsAlreadyListedException) {
    return codedHttpError(HttpStatus.BAD_REQUEST, 'BULK_VARIANTS_ALREADY_LISTED', error.message, {
      skippedCount: error.skippedCount,
    });
  }
  if (error instanceof MasterStockNotSyncedException) {
    return codedHttpError(HttpStatus.BAD_REQUEST, 'BULK_MASTER_STOCK_NOT_SYNCED', error.message, {
      skippedCount: error.skippedCount,
    });
  }
  if (error instanceof InvalidEanException) {
    return codedHttpError(HttpStatus.BAD_REQUEST, 'BULK_EAN_INVALID', error.message, {
      variantId: error.variantId,
      ean: error.ean,
    });
  }
  if (error instanceof DuplicateBatchEanException) {
    return codedHttpError(HttpStatus.BAD_REQUEST, 'BULK_EAN_DUPLICATE', error.message, {
      ean: error.ean,
      variantIds: error.variantIds.join(', '),
    });
  }
  if (error instanceof CurrencyMismatchException) {
    return codedHttpError(HttpStatus.BAD_REQUEST, 'BULK_CURRENCY_MISMATCH', error.message, {
      overrideKey: error.overrideKey,
      overrideCurrency: error.overrideCurrency,
      batchCurrency: error.batchCurrency,
    });
  }
  if (error instanceof InvalidOverrideKeyException) {
    return codedHttpError(HttpStatus.BAD_REQUEST, 'BULK_OVERRIDE_KEY_INVALID', error.message, {
      field: error.field,
      key: error.key,
    });
  }
  if (error instanceof ExpandedOfferCeilingExceededException) {
    return codedHttpError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'BULK_OFFER_CEILING_EXCEEDED',
      error.message,
      { expandedCount: error.expandedCount, ceiling: error.ceiling }
    );
  }
  return null;
}
