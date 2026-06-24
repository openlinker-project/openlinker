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
 *   2. `toBridgeDocumentType` — map the neutral doctype to the bridge-native
 *      `documentType` string ('invoice'->'FV' [faktura], 'receipt'->'PA'
 *      [paragon]). Anything outside the supported set throws
 *      `SubiektUnsupportedDocumentTypeError`.
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
 * Map a neutral document type to the bridge-native `documentType` (`FV`/`PA`).
 * @throws SubiektUnsupportedDocumentTypeError when `neutral` is outside
 *   `{invoice, receipt}`.
 */
export function toBridgeDocumentType(neutral: string): BridgeDocumentType {
  if (neutral === 'invoice' || neutral === 'receipt') {
    return NEUTRAL_TO_BRIDGE_DOCUMENT_TYPE[neutral];
  }
  throw new SubiektUnsupportedDocumentTypeError(neutral);
}
