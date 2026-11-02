/**
 * Buyer Email Delivery Types (#3554)
 *
 * What happened to one automatic buyer email: `sent`, `suppressed` (the gate
 * refused it, with a closed reason) or `bounced` (the mail server refused the
 * recipient). `pending` is the at-most-once claim taken BEFORE the send: the
 * row that holds the subject's slot while the mailer runs. A transport outage
 * is not a delivery outcome - nothing reached the buyer's server - so its claim
 * is released and it is reported as a failed automation step instead.
 *
 * A `pending` row that outlives its send means the process died mid-send; it
 * keeps the slot, so the buyer may miss that email but never gets it twice.
 *
 * @module libs/core/src/orders/domain/types
 */
export const BuyerEmailOutcomeValues = ['pending', 'sent', 'suppressed', 'bounced'] as const;
export type BuyerEmailOutcome = (typeof BuyerEmailOutcomeValues)[number];

/** Why the gate refused to send - one closed reason per refusal, for the timeline. */
export const BuyerEmailSuppressionReasonValues = [
  'emails-off-for-connection',
  'template-not-enabled',
  'template-not-allowed-on-channel',
  'no-buyer-address',
  'already-sent',
] as const;
export type BuyerEmailSuppressionReason = (typeof BuyerEmailSuppressionReasonValues)[number];

export function isBuyerEmailOutcome(value: unknown): value is BuyerEmailOutcome {
  return (
    typeof value === 'string' && (BuyerEmailOutcomeValues as readonly string[]).includes(value)
  );
}

/**
 * Whether a mailer error means the recipient's server REFUSED the address
 * (SMTP 550-553 at RCPT, or a transport that reports the address as rejected),
 * as opposed to the transport being unreachable. Pure so it can be tested
 * without a mail server; the shape read is nodemailer's, typed structurally.
 */
export function isRecipientRejectedError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { responseCode?: unknown; command?: unknown; rejected?: unknown };
  if (Array.isArray(e.rejected) && e.rejected.length > 0) return true;
  const code = typeof e.responseCode === 'number' ? e.responseCode : NaN;
  return code >= 550 && code <= 553 && (e.command === undefined || e.command === 'RCPT TO');
}
