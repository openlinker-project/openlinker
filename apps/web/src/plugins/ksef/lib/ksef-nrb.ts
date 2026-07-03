/**
 * KSeF NRB/IBAN normalization (#1311)
 *
 * Single source of truth for stripping the whitespace an operator may paste
 * into the bank-account-number field (the UI placeholder itself suggests the
 * conventionally-spaced NRB format). Mirrors the `normalizeNip` precedent:
 * both the assembly path (`ksef-payment-config.ts`) and the edit-schema check
 * (`ksef-connection-config.ts`) call this so the persisted
 * `config.payment.bankAccount.nrRb` shape (no inner whitespace) can't drift,
 * and the FE length check counts the same characters the BE shape validator
 * sees on the wire (`NrRB` is 10-34 chars per the FA(3) `TNrRB` type).
 *
 * @module plugins/ksef/lib
 */
export function normalizeNrRb(value: string): string {
  return value.replace(/\s/g, '');
}
