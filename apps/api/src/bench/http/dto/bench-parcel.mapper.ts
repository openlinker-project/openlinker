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
import type { BenchParcelView } from '../../application/types/bench-parcel.types';
import type { BenchParcelResponseDto } from './bench-parcel-response.dto';

export function toParcelResponseDto(view: BenchParcelView): BenchParcelResponseDto {
  return {
    workId: view.workId,
    version: view.version,
    orderReference: view.orderReference,
    buyerName: view.buyerName,
    totalAmount: view.totalAmount,
    currency: view.currency,
    carrierName: view.carrierName,
    dispatchByAt: view.dispatchByAt,
    parcelIndex: view.parcelIndex,
    parcelTotal: view.parcelTotal,
    refusal: view.refusal,
    holdReason: view.holdReason,
    closedAt: view.closedAt,
    packedByUserId: view.packedByUserId,
    invoicePrintedAt: view.invoicePrintedAt,
    labelPrintedAt: view.labelPrintedAt,
    completedAt: view.completedAt,
    lines: view.lines.map((line) => ({
      workLineId: line.workLineId,
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
  };
}
