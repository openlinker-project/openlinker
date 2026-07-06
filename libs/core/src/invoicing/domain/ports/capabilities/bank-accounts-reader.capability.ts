/**
 * Bank Accounts Reader Capability
 *
 * Optional sub-capability of `InvoicingPort` (#1303 follow-up): an invoicing
 * adapter that can discover the seller's payable bank accounts declares
 * `implements BankAccountsReader`. Lets a provider that requires a specific
 * bank account to be named on the document (e.g. inFakt's `bank_account`/
 * `bank_name` invoice fields) surface a live picker instead of the operator
 * guessing which account to configure.
 *
 * Neutral-vocabulary litmus (ADR-026, mirrors `RegulatoryStatusReader`): no
 * provider-specific field names here — `InvoicingBankAccount` carries only the
 * shape every accounting provider's bank-account concept reduces to.
 *
 * Call sites resolve the `Invoicing` capability adapter per-connection, then
 * narrow with `isBankAccountsReader` before invoking — a provider without this
 * capability (no bank-account concept, or always resolves it implicitly)
 * simply doesn't implement it.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';

export interface InvoicingBankAccount {
  id: string;
  accountNumber: string;
  bankName: string;
  /** Whether the provider itself marks this as the seller's default account. */
  isDefault: boolean;
}

export interface BankAccountsReader {
  /** List the seller's payable bank accounts known to the provider. */
  listBankAccounts(): Promise<InvoicingBankAccount[]>;
}

export function isBankAccountsReader(
  adapter: InvoicingPort,
): adapter is InvoicingPort & BankAccountsReader {
  return typeof (adapter as Partial<BankAccountsReader>).listBankAccounts === 'function';
}
