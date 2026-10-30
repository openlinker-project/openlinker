/**
 * Inventory Correction Response DTOs (#3566)
 *
 * @module apps/api/src/inventory/http/dto
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  InventoryCorrectionTargetRefusalReasonValues,
  type InventoryCorrectionResult,
  type InventoryCorrectionStatus,
  type InventoryCorrectionTarget,
  type InventoryCorrectionTargetRefusalReason,
} from '@openlinker/core/inventory';

export class CorrectionTargetResponseDto {
  @ApiProperty({ enum: ['ready', 'refused'] })
  kind!: 'ready' | 'refused';

  @ApiProperty({ enum: InventoryCorrectionTargetRefusalReasonValues, nullable: true })
  reason!: InventoryCorrectionTargetRefusalReason | null;

  @ApiProperty({ nullable: true, type: String })
  productId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  productVariantId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  connectionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  connectionName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  platformType!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: "The owner position's mirrored available quantity.",
  })
  currentQuantity!: number | null;
}

export function toCorrectionTargetResponseDto(
  target: InventoryCorrectionTarget
): CorrectionTargetResponseDto {
  if (target.kind === 'refused') {
    return {
      kind: 'refused',
      reason: target.reason,
      productId: null,
      productVariantId: null,
      connectionId: null,
      connectionName: null,
      platformType: null,
      currentQuantity: null,
    };
  }
  return {
    kind: 'ready',
    reason: null,
    productId: target.productId,
    productVariantId: target.productVariantId,
    connectionId: target.connectionId,
    connectionName: target.connectionName,
    platformType: target.platformType,
    currentQuantity: target.currentQuantity,
  };
}

export class CorrectionAdjustmentOutcomeDto {
  @ApiProperty({ enum: ['applied', 'deduplicated'] })
  disposition!: 'applied' | 'deduplicated';

  @ApiProperty({
    enum: ['honoured', 'unsupported', 'not_requested'],
    description: 'An adapter that reports nothing reads as `unsupported`.',
  })
  idempotency!: 'honoured' | 'unsupported' | 'not_requested';

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: "The master's own instant; null when it reports none (never OpenLinker's clock).",
  })
  appliedAt!: string | null;
}

export class CorrectionMasterDto {
  @ApiProperty()
  connectionId!: string;

  @ApiProperty()
  connectionName!: string;

  @ApiProperty()
  platformType!: string;
}

export class CorrectionRefusalDto {
  @ApiProperty({ description: '`master-refused` | `master-product-not-found` | `adapter-unresolved`' })
  reason!: string;

  @ApiProperty({ nullable: true, type: String, description: "The adapter's own sentence, verbatim." })
  detail!: string | null;
}

export class CorrectStockResponseDto {
  @ApiProperty({ enum: ['applied', 'refused', 'in_doubt'] })
  status!: InventoryCorrectionStatus;

  @ApiProperty({ description: 'The ledger row of this correction.' })
  movementId!: string;

  @ApiProperty({ description: 'The signed change that was requested (computed from the master in `set` mode).' })
  requestedDelta!: number;

  @ApiProperty({ nullable: true, type: Number })
  quantityBefore!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  quantityAfter!: number | null;

  @ApiProperty({ nullable: true, type: CorrectionAdjustmentOutcomeDto })
  adjustmentOutcome!: CorrectionAdjustmentOutcomeDto | null;

  @ApiProperty({ type: CorrectionMasterDto })
  master!: CorrectionMasterDto;

  @ApiProperty({ nullable: true, type: CorrectionRefusalDto })
  refusal!: CorrectionRefusalDto | null;

  @ApiProperty({ description: 'True when the idempotency key already existed; nothing was sent again.' })
  deduplicated!: boolean;
}

export function toCorrectStockResponseDto(result: InventoryCorrectionResult): CorrectStockResponseDto {
  return {
    status: result.status,
    movementId: result.movementId,
    requestedDelta: result.requestedDelta,
    quantityBefore: result.quantityBefore,
    quantityAfter: result.quantityAfter,
    adjustmentOutcome:
      result.adjustmentOutcome === null
        ? null
        : {
            disposition: result.adjustmentOutcome.disposition,
            idempotency: result.adjustmentOutcome.idempotency,
            appliedAt: result.adjustmentOutcome.appliedAt?.toISOString() ?? null,
          },
    master: result.master,
    refusal: result.refusal,
    deduplicated: result.deduplicated,
  };
}
