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
import type { CorrectionReference, InvoiceLine, IssueInvoiceCommand } from '@openlinker/core/invoicing';
import type {
  Fa3BuilderInput,
  Fa3CorrectionContext,
  Fa3Line,
  Fa3PaymentInput,
  SellerProfile,
} from './fa3-xml.types';
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
  /**
   * Connection-resolved fallback `P_12` neutral code (see
   * `DEFAULT_FA3_TAX_RATE` in `fa3-tax-rate.mapper.ts`), applied to any line
   * whose neutral `taxRate` arrives empty — core has no per-line tax rate to
   * give (ADR-026). Always a concrete value by the time this context exists;
   * the factory resolves it (connection config or the PL standard default).
   *
   * This is adapter-scoped issuance *policy*, not seller identity — it does
   * not belong on `SellerProfile` (which mirrors `Podmiot1` XML fields only)
   * even though both are resolved from the same connection config.
   */
  defaultTaxRate: string;
  /**
   * Resolved connection-level payment defaults (#1311) — `undefined` when the
   * connection has none configured, in which case the builder omits
   * `Platnosc` entirely.
   */
  payment?: Fa3PaymentInput;
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
  return {
    seller: context.seller,
    buyer: resolveBuyerIdentity(cmd.buyer.taxId),
    buyerName: cmd.buyer.name,
    buyerAddress: cmd.buyer.address,
    currency: resolveKodWaluty(cmd.currency),
    issueDate: context.issueDate,
    invoiceNumber: context.invoiceNumber,
    generatedAt: context.generatedAt,
    lines: cmd.lines.map((line) => mapLine(line, context.defaultTaxRate)),
    ...(cmd.correction !== undefined
      ? { correction: mapCorrection(cmd.correction, context.defaultTaxRate) }
      : {}),
    ...(context.payment !== undefined ? { payment: context.payment } : {}),
  };
}

/**
 * Map one neutral line to a fully-mapped FA(3) line (applies the P_12 mapper).
 * An empty neutral `taxRate` (core has no per-line rate to give — ADR-026)
 * falls back to the connection's `defaultTaxRate` before resolution; a
 * non-empty rate is never overridden, so a genuine unmapped/mis-keyed code
 * still surfaces loudly via `resolveP12`'s throw.
 */
function mapLine(line: InvoiceLine, defaultTaxRate: string): Fa3Line {
  return {
    name: line.name,
    quantity: line.quantity,
    unitPriceGross: line.unitPriceGross,
    p12: resolveP12(line.taxRate || defaultTaxRate),
  };
}

/**
 * Map the neutral {@link CorrectionReference} to a fully-mapped FA(3) correction
 * context. The caller narrows `cmd.correction !== undefined` and passes the
 * already-narrowed descriptor, so no re-check is needed here. The neutral
 * `originalClearanceReference` (the opaque authority reference; `null` if never
 * cleared) becomes the `NrKSeF`/`NrKSeFN` choice. A return/refund corrects line
 * items, so `TypKorekty` defaults to `2` (see FA3_IMPLEMENTATION_NOTES.md).
 */
function mapCorrection(
  correction: CorrectionReference,
  defaultTaxRate: string,
): Fa3CorrectionContext {
  return {
    typKorekty: '2',
    reason: correction.reason,
    originalIssueDate: correction.originalIssueDate,
    originalInvoiceNumber: correction.originalDocumentNumber,
    originalKsefNumber: correction.originalClearanceReference,
    correctedLines: correction.correctedLines.map((line) => mapLine(line, defaultTaxRate)),
  };
}
