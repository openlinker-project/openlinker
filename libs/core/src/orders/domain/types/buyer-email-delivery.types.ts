/**
 * Buyer Email Delivery Types (#3554)
 *
 * What happened to one automatic buyer email: `sent`, `suppressed` (the gate
 * refused it, with a closed reason) or `bounced` (the mail server refused the
 * recipient). A transport outage is not a delivery outcome - nothing reached
 * the buyer's server either way - so it is reported as a failed automation step
 * and not recorded here.
 *
 * @module libs/core/src/orders/domain/types
 */
export const BuyerEmailOutcomeValues = ['sent', 'suppressed', 'bounced'] as const;
export type BuyerEmailOutcome = (typeof BuyerEmailOutcomeValues)[number];

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
