/**
 * FA(3) Cross-Border Interim Guard
 *
 * Refuses issuance of a cross-border sale until OpenLinker can select the
 * correct FA(3) tax band (WDT / export / `np` / OSS) from the buyer country
 * (#1586). Today the pipeline applies the connection's domestic default rate to
 * every line regardless of `buyer.address.countryIso2`; for a sale shipped to a
 * different country that produces a silently-wrong domestic-rate document. This
 * pure guard is the interim safety net: when the buyer's country differs from
 * the seller's own country AND the connection has not opted into cross-border
 * handling, it throws a clear terminal exception instead. The per-connection
 * `allowCrossBorder` override suppresses the throw (the operator asserts they
 * have handled banding out of band).
 *
 * Pure and synchronous (no I/O, no clock) - country codes are compared
 * case-insensitively and trimmed so a lowercase source ISO code and an
 * uppercase seller-config code never trigger a false cross-border refusal.
 * The full per-order band-selection function is a documented follow-up
 * (see FA3_IMPLEMENTATION_NOTES.md).
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import { KsefCrossBorderUnsupportedException } from '../../../domain/exceptions/ksef-cross-border-unsupported.exception';

/**
 * Assert a sale is either domestic or explicitly opted into cross-border
 * handling. Throws {@link KsefCrossBorderUnsupportedException} when the buyer
 * country differs from the seller country and `allowCrossBorder` is not set.
 *
 * @param sellerCountry Seller's own ISO 3166-1 alpha-2 country (Podmiot1).
 * @param buyerCountry  Buyer's ISO 3166-1 alpha-2 country (from the command).
 * @param allowCrossBorder Interim escape hatch - `true` suppresses the throw.
 */
export function assertCrossBorderHandled(
  sellerCountry: string,
  buyerCountry: string,
  allowCrossBorder: boolean,
): void {
  if (allowCrossBorder) {
    return;
  }
  const seller = sellerCountry.trim().toUpperCase();
  const buyer = buyerCountry.trim().toUpperCase();
  // An empty/absent buyer country is not a cross-border signal on its own - the
  // downstream KodKraju resolver already rejects a genuinely-invalid code. Only
  // a present, different country trips the guard.
  if (buyer.length === 0 || buyer === seller) {
    return;
  }
  throw new KsefCrossBorderUnsupportedException(seller, buyer);
}
