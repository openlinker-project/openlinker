/**
 * The one place `BenchParcelView` -> `BenchParcelResponseDto` is spelled
 * (#3412, mockup-parity epic #3401).
 *
 * `BenchParcelController` and `BenchWorkController` (its `claim-next` route)
 * both need to serialise a parcel; before this each wrote its own
 * field-by-field mapping, which is exactly the shape where a field added to
 * one is silently missing from the other. Field-by-field, never a spread —
 * see `bench-parcel-response.dto.ts`'s module docblock for why.
 *
 * @module apps/api/src/bench/http/dto
 */
import type {
  BenchParcelRouteView,
  BenchParcelView,
} from '../../application/types/bench-parcel.types';
import type { BenchParcelResponseDto, BenchParcelRouteResponseDto } from './bench-parcel-response.dto';

export function toParcelResponseDto(view: BenchParcelView): BenchParcelResponseDto {
  return {
    workId: view.workId,
    version: view.version,
    orderReference: view.orderReference,
    buyerName: view.buyerName,
    totalAmount: view.totalAmount,
    currency: view.currency,
    carrierName: view.carrierName,
    route: toRouteResponseDto(view.route),
    assignedToUserId: view.assignedToUserId,
    dispatchByAt: view.dispatchByAt,
    parcelIndex: view.parcelIndex,
    parcelTotal: view.parcelTotal,
    refusal: view.refusal,
    holdReason: view.holdReason,
    sourceChange:
      view.sourceChange === null
        ? null
        : { takeOut: view.sourceChange.takeOut.map((entry) => ({ ...entry })) },
    closedAt: view.closedAt,
    packedByUserId: view.packedByUserId,
    invoicePrintedAt: view.invoicePrintedAt,
    labelPrintedAt: view.labelPrintedAt,
    completedAt: view.completedAt,
    lines: view.lines.map((line) => ({
      workLineId: line.workLineId,
      bundle: line.bundle,
      productVariantId: line.productVariantId,
      name: line.name,
      sku: line.sku,
      ean: line.ean,
      gtin: line.gtin,
      requiredQuantity: line.requiredQuantity,
      verifiedQuantity: line.verifiedQuantity,
      imageUrl: line.imageUrl,
      attributes: line.attributes,
      binCode: line.binCode,
      weightGrams: line.weightGrams,
      lengthMm: line.lengthMm,
      widthMm: line.widthMm,
      heightMm: line.heightMm,
    })),
    buyerNote: view.buyerNote,
    hasBuyerNote: view.hasBuyerNote,
    buyerNoteAcknowledgedAt: view.buyerNoteAcknowledgedAt,
    buyerNoteAcknowledgedByUserId: view.buyerNoteAcknowledgedByUserId,
    otherParcelBuyerNoteAcknowledgements: view.otherParcelBuyerNoteAcknowledgements.map((entry) => ({
      workId: entry.workId,
      parcelIndex: entry.parcelIndex,
      acknowledgedAt: entry.acknowledgedAt,
      acknowledgedByUserId: entry.acknowledgedByUserId,
    })),
    packerNotes: view.packerNotes.map((note) => ({
      id: note.id,
      body: note.body,
      authorUsername: note.authorUsername,
      createdAt: note.createdAt,
    })),
  };
}

/**
 * Field by field, like the rest of the parcel. The falsy test rather than
 * `=== null` is deliberate: a view built before #3958 (a partial fixture, a
 * cached shape) carries no `route` key at all, and that must serialise as
 * "not resolved" instead of throwing on a property read.
 */
function toRouteResponseDto(
  route: BenchParcelRouteView | null | undefined
): BenchParcelRouteResponseDto | null {
  if (!route) return null;
  return {
    processorKind: route.processorKind,
    processorName: route.processorName,
    fromRule: route.fromRule,
    processorAvailable: route.processorAvailable,
    methodLabel: route.methodLabel,
  };
}
