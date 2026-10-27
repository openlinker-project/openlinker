/**
 * EparagonyApiError
 *
 * Thrown for a non-2xx response from the Documents REST API.
 *
 * Carries the neutral `failureMode` discriminator core's `FiscalRegistrationService`
 * reads STRUCTURALLY off the throwable (ADR-042 decision 7) - core never
 * value-imports this class - plus a short, PII-free `reason` core stamps on the
 * record as the operator-facing summary of a terminal rejection.
 *
 * The default classification is deliberately asymmetric and is stated once here
 * so no call site has to re-derive it:
 *
 *   - `4xx` other than `408`, `409`, `422`, `425` and `429`, WHEN `errorCode`
 *     parsed -> `'rejected'`. The request was refused at the API boundary, so
 *     no document and no fiscal registration was created. Re-crossing the
 *     boundary is safe: the request carries the sale's deterministic
 *     `documentToken`, and the vendor refuses a second document under a token
 *     it already holds (`errorCode: 118`), which the adapters resolve by reading
 *     that document instead of creating one.
 *   - `422` -> `'in-doubt'`. The vendor returns it when the SAME
 *     `Idempotency-Key` is replayed with DIFFERENT data. That proves an earlier
 *     request under the key exists - NOT that a document does: the vendor
 *     remembers a key even when the earlier request was refused (observed live,
 *     a `400` followed by a corrected retry). The adapters therefore settle it
 *     with a status read of the document token; on its own it stays in doubt,
 *     because reading it as `'rejected'` could be the exact wrong-direction
 *     error this taxonomy exists to prevent.
 *   - `408` and `425` -> `'in-doubt'`. Both mean the server may have SEEN the
 *     request (a slow client body, a replayed-too-early request) rather than
 *     refused it outright, so treating either as a clean rejection is not safe.
 *   - `409` -> `'in-doubt'`, EVEN when `errorCode` parsed to something the
 *     adapter doesn't specifically recognise. `409 Conflict` is by definition a
 *     statement about server-side state - the server saw the request - which is
 *     exactly the "may have landed" shape this list exists for. The adapter's
 *     `DOCUMENT_ALREADY_EXISTS` short-circuit still handles the recognised case
 *     directly; this catches every OTHER 409 body, parseable or not. The
 *     failure is asymmetric: a wrong `in-doubt` costs one manual reconcile, a
 *     wrong `rejected` licenses a second real fiscal registration for one sale.
 *   - Any OTHER `4xx` whose `errorCode` could NOT be parsed -> `'in-doubt'`.
 *     This is the ambiguous case that matters most: a response whose body was
 *     truncated (the vendor caps error bodies at 4 MB) leaves no `errorCode` to
 *     reason about. Without a parsed code there is nothing distinguishing
 *     "definitely refused" from "our own earlier attempt already landed", so
 *     the fiscal-safe default applies instead of guessing rejected.
 *   - `429` and `5xx` -> `'in-doubt'`. The vendor documents 502/503/504 as
 *     retry-worthy; either may have been raised after the document was created.
 *
 * A caller with better information (e.g. a status read that returned a terminal
 * `ERROR`) constructs the error with an explicit mode instead.
 *
 * WHAT THE OPERATOR IS TOLD. `reason` is always composed from fixed text and the
 * vendor's NUMERIC `errorCode` - never from the vendor's message, which can echo
 * the submitted document - so the class declares `reasonIsOperatorSafe` and core
 * stores the sentence on the record instead of a generic "the provider rejected
 * it". A small curated table ({@link KNOWN_REJECTIONS}) upgrades a refusal whose
 * meaning is known and PII-free to a specific sentence: the vendor's message is
 * COMPARED against an exact, known text and then dropped, never stored. That is
 * how `errorCode: 41` + "Incorrect merchantTIN" becomes "the seller tax number on
 * this connection is not the one registered" - code 41 alone cannot say so, since
 * the vendor uses it for every validation failure.
 *
 * Two declared causes ride along for core's classification: a known refusal of
 * a CONNECTION setting declares `connection-setting-rejected` (the fix is on the
 * connection, not the order), and an `in-doubt` failure the vendor actually
 * answered declares `provider-answer-inconclusive` (so it is never described as
 * a timeout). `408` keeps the default, because a request timeout IS one.
 *
 * @module libs/integrations/eparagony/src/domain/exceptions
 */
import type {
  CONNECTION_SETTING_REJECTED_FAILURE_CAUSE,
  PROVIDER_ANSWER_INCONCLUSIVE_FAILURE_CAUSE,
} from '@openlinker/core/invoicing';

import { extractRejectedFields } from '../policies/rejected-fields.policy';
import type { EparagonyErrorBody } from '../types/eparagony-api.types';

export type EparagonyFailureMode = 'rejected' | 'in-doubt';

/** Neutral causes this error may declare; see the class header. */
export type EparagonyFailureCause =
  | typeof CONNECTION_SETTING_REJECTED_FAILURE_CAUSE
  | typeof PROVIDER_ANSWER_INCONCLUSIVE_FAILURE_CAUSE;

/** Upper bound on the operator-facing `reason`; core truncates again at 200. */
const MAX_REASON_LENGTH = 200;

export class EparagonyApiError extends Error {
  /** Neutral discriminator read structurally by core. */
  readonly failureMode: EparagonyFailureMode;

  /**
   * Short, PII-free operator-facing summary. Core reads it structurally for a
   * terminal rejection. Never the raw response body - a vendor error message can
   * echo submitted line names.
   */
  readonly reason: string;

  /** Vendor `errorCode`, when the body carried one. Open set - never switched exhaustively. */
  readonly errorCode: number | null;

  /**
   * Schema field paths the vendor named (allowlisted by `extractRejectedFields`,
   * never values). Empty when the body named none or was not readable.
   */
  readonly rejectedFields: readonly string[];

  /**
   * Read structurally by core's invoice failure classification. Every `reason`
   * this class carries is fixed text plus a numeric code - including the
   * `options.reason` callers pass, which must keep to the same rule - so core
   * may store it as the record's operator-facing `failureReason`.
   */
  readonly reasonIsOperatorSafe = true as const;

  /** Declared cause for core's classification, when one applies. */
  readonly failureCause: EparagonyFailureCause | undefined;

  constructor(
    message: string,
    readonly statusCode: number,
    // Deliberately NOT stored on `this` (S3): the raw vendor body can quote a
    // submitted line name, and nothing here reads it once `errorCode` is
    // extracted and the known-rejection lookup has compared its message - a
    // generic `JSON.stringify(err)` upstream must never be able to leak it back
    // out.
    responseBody: EparagonyErrorBody | string | null,
    options?: {
      failureMode?: EparagonyFailureMode;
      reason?: string;
      failureCause?: EparagonyFailureCause;
    }
  ) {
    super(message);
    this.name = 'EparagonyApiError';
    this.errorCode = readErrorCode(responseBody);
    this.rejectedFields = extractRejectedFields(responseBody);
    this.failureMode = options?.failureMode ?? defaultFailureMode(statusCode, this.errorCode);
    // A known refusal is looked up only for a default-classified rejection: a
    // caller that supplied its own reason knows better, and a known text on an
    // in-doubt answer must never read as the clean refusal its copy describes.
    const known =
      options?.reason === undefined && this.failureMode === 'rejected'
        ? findKnownRejection(this.errorCode, responseBody)
        : null;
    this.reason = (
      options?.reason ??
      known?.reason ??
      defaultReason(statusCode, this.errorCode, this.rejectedFields)
    ).slice(0, MAX_REASON_LENGTH);
    this.failureCause =
      options?.failureCause ??
      known?.failureCause ??
      defaultFailureCause(statusCode, this.failureMode);
    Error.captureStackTrace(this, this.constructor);
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isServerError(): boolean {
    return this.statusCode >= 500;
  }

  /** `401`/`403` - the credentials or the granted scope set were rejected. */
  isAuthRejection(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

/** 4xx codes that mean "may have been seen", never a clean refusal. */
const AMBIGUOUS_CLIENT_ERROR_CODES: readonly number[] = [408, 409, 422, 425, 429];

function defaultFailureMode(statusCode: number, errorCode: number | null): EparagonyFailureMode {
  const isClientError = statusCode >= 400 && statusCode < 500;
  if (!isClientError) {
    return 'in-doubt';
  }
  if (AMBIGUOUS_CLIENT_ERROR_CODES.includes(statusCode)) {
    return 'in-doubt';
  }
  // An unparseable errorCode leaves nothing to distinguish "definitely
  // refused" from "our own earlier attempt already landed" (e.g. a 409 whose
  // body was truncated past the DOCUMENT_ALREADY_EXISTS short-circuit) -
  // the fiscal-safe default applies rather than guessing rejected.
  if (errorCode === null) {
    return 'in-doubt';
  }
  return 'rejected';
}

function defaultReason(
  statusCode: number,
  errorCode: number | null,
  rejectedFields: readonly string[]
): string {
  const suffix = errorCode === null ? '' : ` (code ${errorCode})`;
  if (statusCode === 401 || statusCode === 403) {
    return `The provider rejected the connection's credentials or granted scopes${suffix}.`;
  }
  if (statusCode === 422) {
    return `The provider refused the request as a repeat of an earlier one with different data; it may already hold a document for this sale${suffix}.`;
  }
  if (statusCode === 409) {
    return `The provider reports a conflict for this request; it may have already been registered${suffix}.`;
  }
  if (statusCode === 429) {
    return `The provider rate-limited the request${suffix}.`;
  }
  if (statusCode >= 500) {
    return `The provider returned a server error${suffix}.`;
  }
  if (rejectedFields.length > 0) {
    return `The provider rejected the document${suffix}. Field: ${rejectedFields.join(', ')}.`;
  }
  return `The provider rejected the document${suffix}.`;
}

/**
 * An in-doubt failure the vendor ANSWERED is declared inconclusive, so core does
 * not report it as a timeout. `408 Request Timeout` is the one answer that is a
 * timeout, and a rejection declares nothing by default.
 */
function defaultFailureCause(
  statusCode: number,
  failureMode: EparagonyFailureMode
): EparagonyFailureCause | undefined {
  if (failureMode !== 'in-doubt' || statusCode === 408) {
    return undefined;
  }
  return 'provider-answer-inconclusive';
}

interface KnownRejection {
  readonly errorCode: number;
  /** Exact vendor message, compared after trimming, case-folding and collapsing spaces. */
  readonly message: string;
  readonly reason: string;
  readonly failureCause?: EparagonyFailureCause;
}

/**
 * Vendor refusals whose meaning is known and whose copy names no order or buyer
 * data. Keyed on BOTH the code and the exact message, because the vendor reuses
 * one code (`41`) for every validation failure - including ones that quote the
 * submitted document - so the code alone cannot select a specific sentence.
 * Only an exact match qualifies: a message that merely contains the text may
 * carry submitted values around it.
 */
export const KNOWN_REJECTIONS: readonly KnownRejection[] = [
  {
    errorCode: 41,
    message: 'incorrect merchanttin',
    reason:
      'The seller tax number on this connection is not the one registered with your eparagony account. Correct it in the connection settings, then retry (code 41).',
    failureCause: 'connection-setting-rejected',
  },
];

function findKnownRejection(
  errorCode: number | null,
  body: EparagonyErrorBody | string | null
): KnownRejection | null {
  if (errorCode === null || body === null || typeof body === 'string') {
    return null;
  }
  const raw = body.message;
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  return (
    KNOWN_REJECTIONS.find(
      (entry) => entry.errorCode === errorCode && entry.message === normalized
    ) ?? null
  );
}

/**
 * Pull `errorCode` out of a response body without assuming the body is JSON, is
 * an object, or carries the field at all.
 */
function readErrorCode(body: EparagonyErrorBody | string | null): number | null {
  if (body === null || typeof body === 'string') {
    return null;
  }
  const raw = body.errorCode;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}
