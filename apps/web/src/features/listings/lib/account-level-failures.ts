/**
 * Account-Level Failures
 *
 * Splits a batch's failed records into the ones a marketplace refused because
 * of the SELLER ACCOUNT (#4004) and the ones it refused because of the offer.
 * The difference decides what the operator can do: an offer refusal is fixed
 * by editing the offer, an account refusal by nothing in OpenLinker - so the
 * batch page states it once and stops offering a per-row fix for it.
 *
 * The codes come from the destination plugin
 * (`OfferValidationContribution.accountLevelRefusal`), never from the host, so
 * no marketplace's vocabulary lives here. A plugin that declares none
 * classifies nothing, and the page renders exactly as before.
 *
 * @module features/listings/lib
 */
import type { BulkBatchRecordSummary } from '../api/bulk-listings.types';

export interface AccountLevelSplit {
  /** Failed records refused because of the seller account. */
  account: BulkBatchRecordSummary[];
  /** Failed records refused because of the offer itself. */
  offer: BulkBatchRecordSummary[];
  /**
   * The first account-level error, quoted verbatim in the notice - the
   * marketplace's own words for the account state, with its code.
   */
  firstAccountError: { code: string; message: string } | null;
}

/**
 * One account-level code anywhere on a record makes the whole record
 * account-level: while the account cannot sell, fixing the offer's other
 * errors wins nothing, and the other errors stay readable in Details.
 */
export function splitAccountLevelFailures(
  failed: readonly BulkBatchRecordSummary[],
  accountCodes: readonly string[],
): AccountLevelSplit {
  const codes = new Set(accountCodes);
  const account: BulkBatchRecordSummary[] = [];
  const offer: BulkBatchRecordSummary[] = [];
  let firstAccountError: AccountLevelSplit['firstAccountError'] = null;
  for (const record of failed) {
    const hit = (record.errors ?? []).find((e) => codes.has(e.code));
    if (hit) {
      account.push(record);
      firstAccountError ??= { code: hit.code, message: hit.message };
    } else {
      offer.push(record);
    }
  }
  return { account, offer, firstAccountError };
}
