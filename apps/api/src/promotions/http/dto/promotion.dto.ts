/**
 * Promotion DTOs (#3935)
 *
 * Request and response shapes of the promotions surface. The benefit is a
 * discriminated union on `kind`; each kind has its own validated class and the
 * core narrowers (`isPromotionBenefit`, `isPromotionCondition`) stay the
 * authority - the validators here only keep an absurd body from being parsed.
 *
 * @module apps/api/src/promotions/http/dto
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PromotionBenefitKindValues,
  PromotionGiftDocumentFormValues,
  PromotionPauseReasonValues,
  type FreeGiftBenefit,
  type PromotionBenefit,
  type PromotionEvaluation,
  type PromotionGiftDocumentForm,
  type PromotionInput,
  type PromotionOutcome,
  type PromotionPauseReason,
  type PromotionView,
} from '@openlinker/core/promotions';

export class GiftPerUnitDto {
  @ApiProperty({ description: 'Internal product id whose units are counted.' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: 'Units of that product per gift batch (1 = every unit).' })
  @IsInt()
  @Min(1)
  per!: number;

  @ApiProperty({ nullable: true, description: 'Most gift batches in one order; null = no ceiling.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxPerOrder!: number | null;
}

export class FreeGiftBenefitDto {
  @ApiProperty({ enum: PromotionBenefitKindValues })
  @IsIn(['free-gift'])
  kind!: 'free-gift';

  @ApiProperty({ description: 'Internal product id of the gift.' })
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ description: 'Internal variant id of the gift.' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiProperty({ description: 'Units per batch.' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ type: GiftPerUnitDto, nullable: true, description: '"For every unit bought" mode.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => GiftPerUnitDto)
  perUnit?: GiftPerUnitDto | null;

  @ApiPropertyOptional({ description: 'Skip when the gift is already in the order. Default true.' })
  @IsOptional()
  @IsBoolean()
  skipIfPresent?: boolean;

  @ApiPropertyOptional({
    enum: PromotionGiftDocumentFormValues,
    description: 'Per-gift document form. Absent means "as in settings".',
  })
  @IsOptional()
  @IsIn(PromotionGiftDocumentFormValues as readonly string[])
  documentForm?: PromotionGiftDocumentForm;

  toBenefit(): FreeGiftBenefit {
    return {
      kind: 'free-gift',
      productId: this.productId,
      variantId: this.variantId,
      quantity: this.quantity,
      perUnit:
        this.perUnit === undefined || this.perUnit === null
          ? null
          : {
              productId: this.perUnit.productId,
              per: this.perUnit.per,
              maxPerOrder: this.perUnit.maxPerOrder ?? null,
            },
      skipIfPresent: this.skipIfPresent ?? true,
      ...(this.documentForm !== undefined && { documentForm: this.documentForm }),
    };
  }
}

export class PromotionLimitsDto {
  @ApiPropertyOptional({ nullable: true, description: 'Unit cap for the whole promotion; reaching it pauses it.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  unitCap?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Most units per resolved customer; null = off.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerLimit?: number | null;
}

export class WritePromotionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    type: [Object],
    description:
      'AND-ed conditions: containsProduct, orderTotalGross, sourceConnection, sourceConnectionIn, orderCountry. Narrowed server-side.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  conditions!: unknown[];

  @ApiProperty({
    type: FreeGiftBenefitDto,
    description: 'What the promotion gives, as a discriminated union on `kind`. Only `free-gift` today.',
  })
  @ValidateNested()
  @Type(() => FreeGiftBenefitDto, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'kind',
      subTypes: [{ value: FreeGiftBenefitDto, name: 'free-gift' }],
    },
  })
  benefit!: FreeGiftBenefitDto;

  @ApiPropertyOptional({ description: 'Omitted means inactive: a promotion is switched on deliberately.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Default true. False = a matching promotion with this stops the ones below it in the list.',
  })
  @IsOptional()
  @IsBoolean()
  combinable?: boolean;

  @ApiPropertyOptional({ type: PromotionLimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PromotionLimitsDto)
  limits?: PromotionLimitsDto;

  @ApiProperty({ description: 'ISO date. A promotion never applies to an order placed before it was saved.' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  toInput(): PromotionInput {
    return {
      name: this.name,
      conditions: this.conditions,
      benefit: this.benefit.toBenefit(),
      ...(this.isActive !== undefined && { isActive: this.isActive }),
      ...(this.combinable !== undefined && { combinable: this.combinable }),
      limits: {
        unitCap: this.limits?.unitCap ?? null,
        customerLimit: this.limits?.customerLimit ?? null,
      },
      effectiveFrom: new Date(this.effectiveFrom),
      effectiveTo: this.effectiveTo ? new Date(this.effectiveTo) : null,
    };
  }
}

export class ReorderPromotionsDto {
  @ApiProperty({ type: [String], description: 'EVERY promotion id, once each, in the new list order.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  promotionIds!: string[];
}

export class ResumePromotionDto {
  @ApiProperty({ description: 'Units to add to the cap. The promotion resumes with that much room.' })
  @IsInt()
  @Min(1)
  additionalUnits!: number;
}

export class EvaluatePromotionsDto {
  @ApiProperty({ description: 'The order to evaluate against. Nothing about it is written.' })
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @ApiPropertyOptional({ description: 'Mark one saved promotion as the subject of the answer.' })
  @IsOptional()
  @IsString()
  promotionId?: string;

  @ApiPropertyOptional({ type: WritePromotionDto, description: 'An unsaved draft to test beside the saved promotions.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => WritePromotionDto)
  promotion?: WritePromotionDto;
}

export type PromotionStatus = 'inactive' | 'scheduled' | 'active' | 'paused' | 'ended';

export class PromotionLimitsResponseDto {
  @ApiProperty({ nullable: true, type: Number }) unitCap!: number | null;
  @ApiProperty({ nullable: true, type: Number }) customerLimit!: number | null;
}

export class PromotionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() position!: number;
  @ApiProperty() effectiveFrom!: string;
  @ApiProperty({ nullable: true, type: String }) effectiveTo!: string | null;
  @ApiProperty({ type: [Object] }) conditions!: readonly unknown[];
  @ApiProperty({ type: Object, description: 'Discriminated on `kind`.' }) benefit!: PromotionBenefit;
  @ApiProperty() combinable!: boolean;
  @ApiProperty({ type: PromotionLimitsResponseDto }) limits!: PromotionLimitsResponseDto;
  @ApiProperty({
    enum: ['inactive', 'scheduled', 'active', 'paused', 'ended'],
    description: 'A derived read for the list; `paused` carries `pausedReason`.',
  })
  status!: PromotionStatus;
  @ApiProperty({ enum: PromotionPauseReasonValues, nullable: true })
  pausedReason!: PromotionPauseReason | null;
  @ApiProperty({ nullable: true, type: String }) pausedAt!: string | null;
  @ApiProperty({ description: 'Benefit units given so far, from the grant ledger.' })
  unitsGiven!: number;
  @ApiProperty({ nullable: true, type: Number, description: 'Unit cap plus any units added by resuming; null = no cap.' })
  effectiveCap!: number | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static fromView(view: PromotionView, now: Date = new Date()): PromotionResponseDto {
    const { promotion, state } = view;
    const dto = new PromotionResponseDto();
    dto.id = promotion.id;
    dto.name = promotion.name;
    dto.isActive = promotion.isActive;
    dto.position = promotion.position;
    dto.effectiveFrom = promotion.effectiveFrom.toISOString();
    dto.effectiveTo = promotion.effectiveTo ? promotion.effectiveTo.toISOString() : null;
    dto.conditions = promotion.conditions;
    dto.benefit = promotion.benefit;
    dto.combinable = promotion.combinable;
    dto.limits = { unitCap: promotion.limits.unitCap, customerLimit: promotion.limits.customerLimit };
    dto.pausedReason = state?.pausedReason ?? null;
    dto.pausedAt = state?.pausedAt ? state.pausedAt.toISOString() : null;
    dto.unitsGiven = view.unitsGiven;
    dto.effectiveCap = view.effectiveCap;
    dto.status = PromotionResponseDto.statusOf(view, dto.pausedReason, now);
    dto.createdAt = promotion.createdAt.toISOString();
    dto.updatedAt = promotion.updatedAt.toISOString();
    return dto;
  }

  private static statusOf(
    view: PromotionView,
    pausedReason: PromotionPauseReason | null,
    now: Date
  ): PromotionStatus {
    const { promotion } = view;
    if (promotion.effectiveTo !== null && promotion.effectiveTo.getTime() < now.getTime()) return 'ended';
    if (!promotion.isActive) return 'inactive';
    if (promotion.effectiveFrom.getTime() > now.getTime()) return 'scheduled';
    return pausedReason === null ? 'active' : 'paused';
  }
}

export class PromotionDryRunVerdictDto {
  @ApiProperty() promotionId!: string;
  @ApiProperty() promotionName!: string;
  @ApiProperty() isSubject!: boolean;
  @ApiProperty({ description: 'The promotion would give its benefit to this order.' }) wouldApply!: boolean;
  @ApiProperty({ description: 'Benefit units it would give; 0 when it would not.' }) quantity!: number;
  @ApiProperty({ nullable: true, type: String, description: 'Why it would not, as a named reason.' })
  reason!: string | null;
  @ApiProperty({ nullable: true, type: String, description: "The evaluator's own reason, with `rule-not-matching`." })
  nonFiringReason!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'The earlier non-combinable promotion that stopped this one.' })
  supersededByPromotionId!: string | null;
  @ApiProperty({ type: [Object], description: 'Every condition with its outcome, for the "why".' })
  conditionTraces!: readonly unknown[];
  @ApiProperty() retroactivityFloorWaived!: boolean;
}

export class PromotionDryRunResponseDto {
  @ApiProperty() orderId!: string;
  @ApiProperty() evaluatedAt!: string;
  @ApiProperty({ type: [PromotionDryRunVerdictDto] }) verdicts!: PromotionDryRunVerdictDto[];

  static from(
    orderId: string,
    evaluatedAt: Date,
    evaluations: readonly PromotionEvaluation[],
    outcomes: readonly PromotionOutcome[],
    subjectPromotionId: string | null
  ): PromotionDryRunResponseDto {
    const evaluationById = new Map(evaluations.map((e) => [e.promotionId, e] as const));
    const dto = new PromotionDryRunResponseDto();
    dto.orderId = orderId;
    dto.evaluatedAt = evaluatedAt.toISOString();
    dto.verdicts = outcomes.map((outcome) => {
      const evaluation = evaluationById.get(outcome.promotionId);
      const verdict = new PromotionDryRunVerdictDto();
      verdict.promotionId = outcome.promotionId;
      verdict.promotionName = outcome.promotionName;
      verdict.isSubject = outcome.promotionId === subjectPromotionId;
      verdict.wouldApply = outcome.applied;
      verdict.quantity = outcome.quantity;
      verdict.reason = outcome.reason;
      verdict.nonFiringReason = outcome.nonFiringReason;
      verdict.supersededByPromotionId = outcome.supersededByPromotionId;
      verdict.conditionTraces = evaluation?.conditionTraces ?? [];
      verdict.retroactivityFloorWaived = evaluation?.retroactivityFloorWaived ?? false;
      return verdict;
    });
    return dto;
  }
}
