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
 * **Why this `extends BankAccountsReader`** — the same genuine is-a that
 * justifies `RegulatoryTransmitter extends RegulatoryStatusReader` (see that
 * file for the "do NOT cargo-cult `extends`" caveat): a settable `accountId`
 * is provider-assigned and only discoverable by listing, so being able to SET
 * a default logically entails being able to LIST the accounts. Narrowing with
 * `isBankAccountDefaultSetter` therefore also promises `listBankAccounts`.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';
import type { BankAccountsReader } from './bank-accounts-reader.capability';

export interface BankAccountDefaultSetter extends BankAccountsReader {
  /** Mark `accountId` as the seller's default bank account with the provider. */
  setDefaultBankAccount(accountId: string): Promise<void>;
}

export function isBankAccountDefaultSetter(
  adapter: InvoicingPort,
): adapter is InvoicingPort & BankAccountDefaultSetter {
  // Multi-method capability (mirrors `isRegulatoryTransmitter`): the narrowed
  // type promises BOTH the setter and the inherited lister, so the runtime
  // guard must verify both — an adapter exposing only `setDefaultBankAccount`
  // would otherwise narrow to a contract it can't honour.
  const partial = adapter as Partial<BankAccountDefaultSetter>;
  return (
    typeof partial.setDefaultBankAccount === 'function' &&
    typeof partial.listBankAccounts === 'function'
  );
}
