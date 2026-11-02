/**
 * Mail log redaction (#3550)
 *
 * The mailer carries the BUYER's address on every document email, not only an
 * operator's. A hash-only deployment (`OL_STORE_PII=false`) refuses to persist
 * that address, so writing it to the application log on every send would leak
 * exactly what it opted out of storing. The log keeps the domain - enough to
 * tell a delivery problem at one provider apart from a general one - and drops
 * the mailbox.
 *
 * @module libs/core/src/mailer/infrastructure/adapters
 */

export function redactRecipient(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '[redacted]' : `[redacted]@${address.slice(at + 1)}`;
}
