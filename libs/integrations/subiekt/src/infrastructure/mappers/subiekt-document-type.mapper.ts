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
 *      correction types) throws `SubiektUnsupportedDocumentTypeError` — corrections
 *      go through the correction path, not the plain issue path.
 *   3. `isCorrectionDocumentType` / `toBridgeCorrectionDocumentType` — recognise a
 *      correction neutral doctype ('credit-note' | 'corrected') and map it to the
 *      bridge-native 'FK' (faktura korygująca). Both correction neutral types map
 *      to the single Subiekt correction document.
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
  const taxId = buyer.taxId;
  const hasPlNip = taxId !== null && taxId.scheme === PL_NIP_SCHEME && taxId.value.length > 0;
  return hasPlNip ? 'invoice' : 'receipt';
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

/** Neutral correction document types Subiekt issues as a faktura korygująca (`FK`). */
const CORRECTION_DOCUMENT_TYPES: ReadonlySet<string> = new Set(['credit-note', 'corrected']);

/** True when `neutral` is a correction document type (routes to the correction path). */
export function isCorrectionDocumentType(neutral: string): boolean {
  return CORRECTION_DOCUMENT_TYPES.has(neutral);
}

/**
 * Map a correction neutral document type to the bridge-native `FK` (faktura
 * korygująca). Both `credit-note` and `corrected` collapse onto the single
 * Subiekt correction document.
 * @throws SubiektUnsupportedDocumentTypeError when `neutral` is not a correction type.
 */
export function toBridgeCorrectionDocumentType(neutral: string): BridgeDocumentType {
  if (isCorrectionDocumentType(neutral)) {
    return 'FK';
  }
  throw new SubiektUnsupportedDocumentTypeError(neutral);
}
