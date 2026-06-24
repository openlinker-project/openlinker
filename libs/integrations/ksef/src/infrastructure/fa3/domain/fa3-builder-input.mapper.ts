/**
 * Neutral → FA(3) Builder-Input Mapper
 *
 * The single neutral→PL mapping seam (ADR-026): turns a country-agnostic
 * `IssueInvoiceCommand` into the fully-mapped `Fa3BuilderInput` the pure builder
 * lays out. It composes the three pure mappers (`resolveBuyerIdentity`,
 * `resolveKodWaluty`, `resolveP12`) so the builder never re-runs country-specific
 * mapping. PL/KSeF specifics stay in this package; no `ksef`/`nip`/`fa` string
 * ever flows back into core.
 *
 * Clock/sequence values the FA(3) needs but the neutral command doesn't carry
 * (issue date, generated-at instant, human invoice number) are supplied by the
 * caller via {@link Fa3MappingContext} — the mapper stays pure (no `Date.now()`),
 * mirroring the pure builder's "no clock inside" contract.
 *
 * @module libs/integrations/ksef/src/infrastructure/fa3/domain
 */
import type { IssueInvoiceCommand } from '@openlinker/core/invoicing';
import type { Fa3BuilderInput, Fa3Line, SellerProfile } from './fa3-xml.types';
import { resolveBuyerIdentity } from './fa3-buyer-id.mapper';
import { resolveKodWaluty } from './fa3-currency.mapper';
import { resolveP12 } from './fa3-tax-rate.mapper';

/**
 * Adapter-supplied clock/sequence values for one document. Kept out of the
 * neutral command (which describes what to issue, not when or which number), so
 * the mapper and the builder both stay pure.
 */
export interface Fa3MappingContext {
  /** Seller identity — system config (Podmiot1), resolved from the connection. */
  seller: SellerProfile;
  /** Invoice issue date `P_1`, ISO calendar `YYYY-MM-DD`. */
  issueDate: string;
  /** Document-generation instant `DataWytworzeniaFa`, ISO-8601 UTC ending `Z`. */
  generatedAt: string;
  /** Human-facing sequential invoice number `P_2`. */
  invoiceNumber: string;
}

/**
 * Map a neutral issue command + adapter clock/sequence context to a fully-mapped
 * `Fa3BuilderInput`. Throws the mapper's own typed faults (unmapped tax rate,
 * unsupported currency, malformed buyer id) — all deterministic build faults the
 * caller maps to a failed `InvoiceRecord`, never a transient retry.
 */
export function mapToFa3BuilderInput(
  cmd: IssueInvoiceCommand,
  context: Fa3MappingContext,
): Fa3BuilderInput {
  const lines: Fa3Line[] = cmd.lines.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceGross: line.unitPriceGross,
    p12: resolveP12(line.taxRate),
  }));

  return {
    seller: context.seller,
    buyer: resolveBuyerIdentity(cmd.buyer.taxId),
    buyerName: cmd.buyer.name,
    buyerAddress: cmd.buyer.address,
    currency: resolveKodWaluty(cmd.currency),
    issueDate: context.issueDate,
    invoiceNumber: context.invoiceNumber,
    generatedAt: context.generatedAt,
    lines,
  };
}
