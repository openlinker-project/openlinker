/**
 * KSeF Payment Assembly (#1311)
 *
 * Single source of truth for assembling the nested `config.payment` shape the
 * KSeF adapter factory's `resolvePayment` reads (`{ formaPlatnosci?,
 * bankAccount?: { nrRb, bankName?, swift? }, paymentTermDays?, skonto?: {
 * conditions, amount } }`). KSeF has no live "list bank accounts" API — unlike
 * inFakt's `BankAccountsReader` capability — so this is a plain, manually-entered
 * config value the operator types in once. Mirrors `ksef-seller-config.ts`'s
 * assembly pattern: `applyKsefPaymentToConfig` touches only the payment leaves
 * present on the patch (so the edit path's per-field sync preserves untouched
 * siblings) and drops an emptied `bankAccount` / `skonto` / `payment` object so a
 * hollow config is never persisted.
 *
 * @module plugins/ksef/lib
 */
import { normalizeNrRb } from './ksef-nrb';

/**
 * Flat payment sub-fields collected by the edit-connection structured section.
 * `paymentTermDays` arrives as a form string and is parsed to an integer at
 * assembly time.
 */
export interface KsefPaymentInput {
  paymentFormaPlatnosci?: string;
  paymentBankAccountNrRb?: string;
  paymentBankAccountBankName?: string;
  paymentBankAccountSwift?: string;
  paymentTermDays?: string;
  paymentSkontoConditions?: string;
  paymentSkontoAmount?: string;
}

/** Trim a free-text leaf. */
function normalizeTextLeaf(value: string): string {
  return value.trim();
}

function setOrDeleteLeaf(target: Record<string, unknown>, key: string, normalized: string): void {
  if (normalized.length === 0) delete target[key];
  else target[key] = normalized;
}

/**
 * Whether any payment sub-field is present on the patch. Used by the edit path
 * to skip the payment branch entirely when a non-payment field is the only
 * thing changing.
 */
export function patchTouchesPayment(input: KsefPaymentInput): boolean {
  return (
    input.paymentFormaPlatnosci !== undefined ||
    input.paymentBankAccountNrRb !== undefined ||
    input.paymentBankAccountBankName !== undefined ||
    input.paymentBankAccountSwift !== undefined ||
    input.paymentTermDays !== undefined ||
    input.paymentSkontoConditions !== undefined ||
    input.paymentSkontoAmount !== undefined
  );
}

/**
 * Apply payment sub-field patches onto an existing `config` object, returning a
 * new config. Only sub-fields present on the patch are touched; siblings are
 * preserved. An emptied leaf is deleted, and an emptied `bankAccount` / `skonto`
 * / `payment` object is dropped so a hollow config is never persisted.
 *
 * `paymentTermDays` is parsed as an integer; a non-numeric or negative value is
 * treated as "clear the field" (deletion), matching the shape validator's own
 * non-negative-integer rule so a value that would be rejected server-side is
 * never sent at all.
 */
export function applyKsefPaymentToConfig(
  base: Record<string, unknown>,
  input: KsefPaymentInput,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  if (!patchTouchesPayment(input)) return next;

  const payment: Record<string, unknown> =
    typeof next.payment === 'object' && next.payment !== null
      ? { ...(next.payment as Record<string, unknown>) }
      : {};
  const bankAccount: Record<string, unknown> =
    typeof payment.bankAccount === 'object' && payment.bankAccount !== null
      ? { ...(payment.bankAccount as Record<string, unknown>) }
      : {};
  const skonto: Record<string, unknown> =
    typeof payment.skonto === 'object' && payment.skonto !== null
      ? { ...(payment.skonto as Record<string, unknown>) }
      : {};

  if (input.paymentFormaPlatnosci !== undefined) {
    setOrDeleteLeaf(payment, 'formaPlatnosci', normalizeTextLeaf(input.paymentFormaPlatnosci));
  }
  if (input.paymentBankAccountNrRb !== undefined) {
    // Whitespace-stripped (not just trimmed): the UI placeholder suggests the
    // spaced NRB format, but `NrRB` goes on the FA(3) wire verbatim and inner
    // spaces would eat into the 34-char TNrRB budget.
    setOrDeleteLeaf(bankAccount, 'nrRb', normalizeNrRb(input.paymentBankAccountNrRb));
  }
  if (input.paymentBankAccountBankName !== undefined) {
    setOrDeleteLeaf(bankAccount, 'bankName', normalizeTextLeaf(input.paymentBankAccountBankName));
  }
  if (input.paymentBankAccountSwift !== undefined) {
    setOrDeleteLeaf(bankAccount, 'swift', normalizeTextLeaf(input.paymentBankAccountSwift));
  }
  if (input.paymentTermDays !== undefined) {
    const parsed = Number.parseInt(input.paymentTermDays.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      payment.paymentTermDays = parsed;
    } else {
      delete payment.paymentTermDays;
    }
  }
  if (input.paymentSkontoConditions !== undefined) {
    setOrDeleteLeaf(skonto, 'conditions', normalizeTextLeaf(input.paymentSkontoConditions));
  }
  if (input.paymentSkontoAmount !== undefined) {
    setOrDeleteLeaf(skonto, 'amount', normalizeTextLeaf(input.paymentSkontoAmount));
  }

  // Only drop a sub-object when NOTHING has been typed into it — never on a
  // missing sibling field. `bankAccount.nrRb` being required and `skonto`
  // needing both `conditions`+`amount` are save-time (shape validator) /
  // issuance-time (factory `resolvePayment`) concerns; gating persistence on
  // them here would silently discard whichever field the operator typed
  // first, since each field syncs independently per keystroke (#1311 smoke
  // test finding).
  if (Object.keys(bankAccount).length === 0) {
    delete payment.bankAccount;
  } else {
    payment.bankAccount = bankAccount;
  }

  if (Object.keys(skonto).length === 0) {
    delete payment.skonto;
  } else {
    payment.skonto = skonto;
  }

  if (Object.keys(payment).length === 0) delete next.payment;
  else next.payment = payment;

  return next;
}
