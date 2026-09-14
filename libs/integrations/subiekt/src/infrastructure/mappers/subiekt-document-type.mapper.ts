/**
 * Subiekt Document-Type Mapper (#753)
 *
 * The Subiekt/PL-specific "NIP -> faktura/paragon" doctype mechanic lives HERE,
 * in the adapter — core never knows the words faktura/paragon/NIP. Two pure
 * steps:
 *   1. `deriveNeutralDocumentType` — choose a NEUTRAL doctype when the caller
 *      did not pass one: a `pl-nip` tax id with a non-empty value -> 'invoice',
 *      otherwise -> 'receipt'. An explicit `command.documentType` is honoured
 *      verbatim. NOTE: `isCompany` is NOT the trigger — NIP presence is.
 *   2. `toBridgeDocumentType` — map a NON-correction neutral doctype to the
 *      bridge-native `documentType` string ('invoice'->'FV' [faktura],
 *      'receipt'->'PA' [paragon]). Anything outside that set (including the
 *      correction types `credit-note`/`corrected`) throws
 *      `SubiektUnsupportedDocumentTypeError` — corrections go through the dedicated
 *      correction capability (`CorrectionIssuer.issueCorrection`), never the plain
 *      issue path, so a correction doctype reaching `issueInvoice` is a clean
 *      rejection.
 *
 * @module libs/integrations/subiekt/src/infrastructure/mappers
 */
import type { BuyerProfile } from '@openlinker/core/invoicing';
import type { DocumentType } from '@openlinker/core/invoicing';
import type { BridgeDocumentType } from '../../bridge/subiekt-bridge.types';
import { SubiektUnsupportedDocumentTypeError } from '../../domain/exceptions/subiekt-unsupported-document-type.exception';

/** Scheme that triggers a faktura (FV) when present with a non-empty value. */
export const PL_NIP_SCHEME = 'pl-nip';

/**
 * The buyer's domestic tax number, or `null` when there is none to send.
 *
 * ONE rule, two readers (this file's document-type trigger and
 * `toBridgeBuyer`'s `nip` field), because they must agree: a document typed
 * `FV` whose buyer carries no `nip` is a faktura with no buyer tax number on
 * it, and the inverse is a paragon carrying one.
 *
 * An UNTAGGED identifier counts (#3224). Since ADR-073 decision 1 core may not
 * mint a `scheme` — an `Order` stores a bare number — an untagged value now
 * reaches every invoicing adapter, and *"an adapter needing a tag supplies
 * it"*. Subiekt nexo is a Polish accounting system with exactly one tax-number
 * slot, so there is no placement to get wrong: the domestic reading is the only
 * one it has. Requiring the tag instead would silently drop the buyer's tax
 * number from every auto-issued document and quietly downgrade it to a paragon.
 *
 * A value that is not in fact a valid Polish NIP is sent and REFUSED BY THE
 * PROVIDER (ADR-073 decision 5); this adapter does not pre-judge it.
 */
export function readDomesticTaxId(taxId: BuyerProfile['taxId']): string | null {
  if (taxId === null) {
    return null;
  }
  if (taxId.scheme !== undefined && taxId.scheme !== PL_NIP_SCHEME) {
    return null;
  }
  return taxId.value.length > 0 ? taxId.value : null;
}

/**
 * Neutral -> bridge-native `documentType`. The bridge accepts `"FV"` (faktura)
 * and `"PA"` (paragon); see the bridge's `CreateInvoiceRequestDto`.
 */
const NEUTRAL_TO_BRIDGE_DOCUMENT_TYPE: Readonly<Record<'invoice' | 'receipt', BridgeDocumentType>> = {
  invoice: 'FV',
  receipt: 'PA',
};

/**
 * Derive the neutral document type. Honours an explicit caller value; otherwise
 * applies the NIP-presence rule (a non-empty `pl-nip` tax id -> 'invoice',
 * otherwise -> 'receipt'). `isCompany` is NOT the trigger — NIP presence is.
 * Returns a NEUTRAL `DocumentType`, never a bridge-native string.
 */
export function deriveNeutralDocumentType(
  buyer: BuyerProfile,
  explicit?: string,
): DocumentType {
  if (explicit !== undefined && explicit.length > 0) {
    return explicit as DocumentType;
  }
  return readDomesticTaxId(buyer.taxId) !== null ? 'invoice' : 'receipt';
}

/**
 * Map a NON-correction neutral document type to the bridge-native `documentType`
 * (`FV`/`PA`).
 * @throws SubiektUnsupportedDocumentTypeError when `neutral` is outside
 *   `{invoice, receipt}` (correction types included — they use the correction path).
 */
export function toBridgeDocumentType(neutral: string): BridgeDocumentType {
  if (neutral === 'invoice' || neutral === 'receipt') {
    return NEUTRAL_TO_BRIDGE_DOCUMENT_TYPE[neutral];
  }
  throw new SubiektUnsupportedDocumentTypeError(neutral);
}
