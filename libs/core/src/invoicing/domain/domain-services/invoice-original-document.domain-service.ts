/**
 * Original-document assembly for a correction (#3540, moved from the invoicing
 * controller)
 *
 * Builds the {@link OriginalDocumentSnapshot} a `CorrectionIssuer` needs from a
 * record's persisted issuance-time line snapshot (#1297): `buyer`/`currency`/
 * `lines` come from the snapshot (the lines AS ISSUED, including the true buyer
 * tax id), `documentType`/clearance/number/issue date from the record itself.
 *
 * Pure and framework-free. It lived as a private method of the HTTP controller
 * until a second caller (the operator-cancel correction confirm) needed the same
 * assembly - two copies of "what the original looked like" is how a correction
 * ends up diffed against different documents depending on the route.
 *
 * Transitional exception: a snapshot persisted by a correction of a PRE-#1297
 * record was seeded from a fallback reconstruction, so its `taxId` is `null` - a
 * one-hop degradation that self-heals for later documents.
 *
 * @module libs/core/src/invoicing/domain/domain-services
 */
import type { InvoiceRecord } from '../entities/invoice-record.entity';
import { BuyerProfile } from '../entities/buyer-profile.entity';
import type { IssuedLineSnapshot, OriginalDocumentSnapshot } from '../types/invoicing.types';

/**
 * ISO 8601 calendar date only (`YYYY-MM-DD`), anchored to UTC (the adapter-side
 * `toIsoDate` precedent). Only a fallback for a snapshot that predates the
 * printed issue date.
 */
function toIsoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Assemble the original-document snapshot from an ISSUED record and its
 * issuance-time snapshot.
 *
 * Requires `providerInvoiceNumber` and `issuedAt` to be present: the caller is
 * expected to have refused an unissued record already, and masking a missing one
 * behind an empty string would silently produce an invalid document number.
 *
 * @throws Error when the record has no document number or issue date.
 */
export function buildOriginalDocumentFromIssuedRecord(
  record: InvoiceRecord,
  snapshot: IssuedLineSnapshot,
): OriginalDocumentSnapshot {
  if (!record.providerInvoiceNumber || !record.issuedAt) {
    throw new Error(
      `Invoice ${record.id} has no document number / issue date; it is not fully issued yet`,
    );
  }
  return {
    buyer: BuyerProfile.fromSnapshot(snapshot.buyer),
    currency: snapshot.currency,
    documentType: record.documentType.length > 0 ? record.documentType : 'invoice',
    lines: snapshot.lines,
    clearanceReference: record.clearanceReference,
    documentNumber: record.providerInvoiceNumber,
    // The date the original PRINTED (DEF-33) when the snapshot has it: the UTC
    // day of `issuedAt` is a different day for anything issued just after local
    // midnight, and the correction must reference the original exactly.
    issueDate: snapshot.issueDate ?? toIsoDateOnly(record.issuedAt),
    ...(snapshot.saleDate !== undefined ? { saleDate: snapshot.saleDate } : {}),
    ...(snapshot.annotations ? { annotations: snapshot.annotations } : {}),
    ...(snapshot.additionalParties?.length
      ? { additionalParties: snapshot.additionalParties }
      : {}),
  };
}
