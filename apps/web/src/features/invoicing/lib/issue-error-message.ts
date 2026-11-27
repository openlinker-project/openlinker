/**
 * resolveIssueErrorMessage (#757, codes since #3863)
 *
 * Pure mapper from a `POST /invoices` failure to an operator-facing sentence,
 * and the predicates the sales-document panel branches on. Every one of them
 * reads the error's stable `code` and `params` (#3863/#3864), never the
 * exception class name the API used to send in `error`: a renamed class must
 * not change what the operator is told.
 *
 * The operator never sees server text here. A rejection with a known
 * `failureCode` reads that code's fixed copy; everything else is
 * `describeApiError`, which chooses copy by code. The one exception is the
 * acknowledgement request, which carries the adapter's own `failureReason` -
 * a sentence the adapter vouched for as operator-safe (#3772).
 *
 * @module apps/web/src/features/invoicing/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { describeApiError } from '../../../shared/api/describe-api-error';
import type { FailureCode } from '../api/invoicing.types';
import { failureCodeCopy } from './derive-invoice-display';

const CAPABILITY_CODES = new Set(['CAPABILITY_NOT_ENABLED', 'CAPABILITY_NOT_SUPPORTED']);

/** Codes for an order the operator may still choose to invoice (DEF-26). */
const OVERRULABLE_ORDER_CODES = new Set(['ORDER_CANCELLED', 'ORDER_FULLY_REFUNDED']);

function stringParam(error: ApiError, name: string): string | undefined {
  const value = error.params[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The `failureCode` of a provider rejection, or `null` for any other error. */
function readRejectionCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'INVOICE_ISSUE_REJECTED') {
    return null;
  }
  return stringParam(error, 'failureCode') ?? null;
}

/** True when the connection's invoicing capability is off or not offered. */
export function isCapabilityDisabledError(error: unknown): boolean {
  return error instanceof ApiError && error.code !== undefined && CAPABILITY_CODES.has(error.code);
}

/**
 * True for the rejection whose fix is a setting on the connection (#3772): the
 * panel then names the setting and links to the connection instead of a toast.
 */
export function isConnectionSetupIncompleteError(error: unknown): boolean {
  return readRejectionCode(error) === 'connection-setup-incomplete';
}

export interface AcknowledgementRequest {
  warningCode: string;
  message: string;
}

/**
 * A refusal the operator may overrule by acknowledging it (DEF-23/26): a
 * rejection with `acknowledgement-required`, or a cancelled / fully refunded
 * order. Returns the code to send back in `acknowledgeWarnings` and the
 * sentence to show, or `null` for any other error.
 */
export function readAcknowledgementRequest(error: unknown): AcknowledgementRequest | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  const overrulable =
    readRejectionCode(error) === 'acknowledgement-required' ||
    (error.code !== undefined && OVERRULABLE_ORDER_CODES.has(error.code));
  const warningCode = stringParam(error, 'warningCode') ?? readDetailString(error, 'warningCode');
  if (!overrulable || warningCode === undefined) {
    return null;
  }
  const failureReason = readDetailString(error, 'failureReason');
  return { warningCode, message: failureReason ?? describeApiError(error) };
}

export function isConnectionSettingError(error: unknown): boolean {
  return readConnectionSettingErrorCode(error) !== null;
}

export type ConnectionSettingFailureCode = Extract<
  FailureCode,
  'connection-setup-incomplete' | 'connection-setting-rejected'
>;

/** Which of the two connection-setting rejections it is, or `null`. */
export function readConnectionSettingErrorCode(error: unknown): ConnectionSettingFailureCode | null {
  const code = readRejectionCode(error);
  return code === 'connection-setup-incomplete' || code === 'connection-setting-rejected'
    ? code
    : null;
}

/** True when the connection has no numbering series for this document. */
export function isMissingNumberingSeriesError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'MISSING_NUMBERING_SERIES';
}

/** The sentence for a failed issue. Never server text, never blank. */
export function resolveIssueErrorMessage(error: unknown): string {
  return failureCodeCopy(readRejectionCode(error)) ?? describeApiError(error);
}

/** A string field the body still carries outside the envelope (kept for older shapes). */
function readDetailString(error: ApiError, name: string): string | undefined {
  const details = error.details;
  if (typeof details !== 'object' || details === null) {
    return undefined;
  }
  const value = (details as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
