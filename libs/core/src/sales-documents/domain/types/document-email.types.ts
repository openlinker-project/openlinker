/**
 * Document email vocabulary (#3550)
 *
 * What a manual "send this sales document to the buyer" produces, shared by the
 * invoice and the fiscal-receipt send services so the order timeline reads ONE
 * vocabulary whichever kind was sent.
 *
 * Country-agnostic (ADR-026): nothing here names a provider or a regime.
 *
 * @module libs/core/src/sales-documents/domain/types
 */

/** Who actually delivered the message: the provider's own mechanism, or OpenLinker's mailer. */
export const DocumentEmailSentViaValues = ['provider', 'openlinker'] as const;
export type DocumentEmailSentVia = (typeof DocumentEmailSentViaValues)[number];

export const DocumentEmailOutcomeValues = ['sent', 'failed'] as const;
export type DocumentEmailOutcome = (typeof DocumentEmailOutcomeValues)[number];

/**
 * Why a send did not go out. A closed union so a surface renders copy per value
 * and a new reason is a compile error at every render site rather than a silent
 * fall-through (the #2231 rule). The persisted value is only ever one of these,
 * never a caught message: SMTP and provider errors carry hosts and credentials.
 */
export const DocumentEmailFailureReasonValues = [
  /** The document exists but was never fully issued. */
  'not-issued',
  /** Issued, but not cleared yet: try again later. */
  'document-not-ready',
  /** Cleared (or nothing to clear) and still nothing to attach or link. */
  'no-document',
  /** No recipient given and the order carries no buyer address. */
  'no-recipient',
  /** The recipient is not a usable email address. */
  'invalid-recipient',
  /** This process has no mailer bound. */
  'mailer-unavailable',
  /** The provider or the mailer failed. */
  'send-failed',
] as const;
export type DocumentEmailFailureReason = (typeof DocumentEmailFailureReasonValues)[number];

export function isDocumentEmailFailureReason(value: unknown): value is DocumentEmailFailureReason {
  return (
    typeof value === 'string' &&
    (DocumentEmailFailureReasonValues as readonly string[]).includes(value)
  );
}

/**
 * Pure recipient check: a single, plain address. Deliberately conservative -
 * the goal is to refuse an obvious typo or a header-injection attempt (a CR/LF
 * or a second address), not to implement RFC 5322. Returns the trimmed address,
 * or `null` when it is not usable.
 */
export function normaliseDocumentEmailRecipient(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 254) return null;
  return /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[^\s@,;<>"()[\]\\]+$/.test(value)
    ? value
    : null;
}
