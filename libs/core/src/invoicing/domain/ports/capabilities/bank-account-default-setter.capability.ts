/**
 * Bank Account Default Setter Capability
 *
 * Optional sub-capability of `InvoicingPort` (#1303 follow-up): an invoicing
 * adapter that can mark one of the seller's bank accounts as the provider's
 * own default declares `implements BankAccountDefaultSetter`. Keeps
 * OpenLinker's per-connection `bankAccount` choice and the provider's own
 * "default account" concept (e.g. inFakt's account settings UI) in sync,
 * rather than drifting apart once the operator can pick an account from
 * either side.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';

export interface BankAccountDefaultSetter {
  /** Mark `accountId` as the seller's default bank account with the provider. */
  setDefaultBankAccount(accountId: string): Promise<void>;
}

export function isBankAccountDefaultSetter(
  adapter: InvoicingPort,
): adapter is InvoicingPort & BankAccountDefaultSetter {
  return (
    typeof (adapter as Partial<BankAccountDefaultSetter>).setDefaultBankAccount === 'function'
  );
}
