/**
 * Is this rejection the bridge saying "no such towar", or the bridge saying
 * it could not do its job?
 *
 * ## Why this is one function and not two copies
 *
 * `SubiektRejectedError` carries BOTH. The bridge returns the
 * `{success:false, error}` envelope for a genuine "nie znaleziono towaru" AND
 * for every condition where it is up but Subiekt is not - a COM session that
 * failed to attach, SQL Server down for maintenance, the GT desktop client
 * left open, an upgrade in progress.
 *
 * Only the first is a master-side deletion. Reading the second as one runs the
 * #1599 chain: `MasterProductNotFoundError` stales the variants, emits
 * `master.product.stale`, and `marketplace.offer.pauseStale` zeroes the offer
 * quantity on EVERY marketplace the variant is mapped on. At 100 products per
 * 20-minute sweep, a fault lasting a working day walks roughly 2 400 products
 * into the dark - and reports each as `outcomeReason: 'master_deleted'`, a
 * label whose whole meaning is "the seller deleted this".
 *
 * Recovery is not automatic either: a staled mapping does not self-heal, and
 * the hourly `marketplace.offer.pauseStaleSweep` re-asserts the pause from the
 * persisted `isStale` flag, so the offers stay at zero after the bridge comes
 * back.
 *
 * ## It lives here because the two adapters had drifted
 *
 * `SubiektInventoryMasterAdapter` tested the reason text before concluding a
 * deletion; `SubiektProductMasterAdapter` converted every rejection
 * unconditionally. One package, one exception type, two answers - which is how
 * an oversight looks rather than a decision. A shared predicate is what stops
 * the next reader having to notice.
 *
 * ## The CODE decides; the prose is only a fallback
 *
 * The bridge's failure envelope is `{code, reason, correlationId, failureMode}`
 * and it answers `code: 'not_found'` with HTTP 404 for exactly this condition -
 * verified against the live bridge on 2026-09-28:
 *
 *     GET /api/products/NO-SUCH-SYMBOL-ZZZ
 *     404 {"success":false,"data":null,"error":{"code":"not_found",
 *          "reason":"No product with symbol NO-SUCH-SYMBOL-ZZZ.", ...}}
 *
 * That probe is also what showed the prose test alone was never sufficient: the
 * CATALOGUE endpoint answers in English ("No product with symbol X.") while the
 * INVENTORY one answers in Polish ("Towar nie znaleziono lub usunięty: X"), so
 * the regex the inventory adapter carried - the only guard that existed - could
 * not have matched a catalogue deletion at all. The code is one string written
 * once per endpoint; the sentence beside it is free text that has already
 * drifted into two languages.
 *
 * The regex survives underneath it for a bridge older than the structured
 * envelope, where `code` arrives undefined. It is a fallback, not the rule.
 *
 * ## It fails CLOSED
 *
 * Neither a recognised code nor a recognised sentence means NOT a deletion. The
 * cost of that mistake is asymmetric: treating a real deletion as a transport
 * fault retries a job and catches up on the next sweep, while treating a
 * transport fault as a deletion takes a catalogue off sale and needs a human to
 * put it back.
 */

/** The bridge's own machine-readable code for "this towar does not exist". */
const BRIDGE_NOT_FOUND_CODE = 'not_found';

export function looksLikeSubiektNotFound(error: {
  readonly reason: string;
  readonly code?: string;
}): boolean {
  if (error.code !== undefined) {
    return error.code === BRIDGE_NOT_FOUND_CODE;
  }
  return /nie znaleziono|not found|nie istnieje|no product with symbol|no model with id/i.test(
    error.reason,
  );
}
