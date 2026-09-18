/**
 * Rule overlap-check DTOs (#3190)
 *
 * The request is a POST because it carries a draft rule body, but it is a
 * READ: it persists nothing and refuses nothing. Naming the rival is the
 * point, so the response returns ids rather than a bare boolean - a warning
 * an operator cannot act on is barely better than the held order it replaces.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  SalesDocumentOverlapDisjointReasonValues,
  SalesDocumentOverlapUndecidedReasonValues,
  type SalesDocumentRuleOverlapVerdict,
} from '@openlinker/core/sales-documents';
import { SalesDocumentConditionDto } from './sales-document-condition.dto';

export class CheckSalesDocumentRuleOverlapDto {
  @ApiProperty({ description: "ISO 3166-1 alpha-2, or '*' for Rest of world" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  country!: string;

  @ApiProperty({ type: [SalesDocumentConditionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SalesDocumentConditionDto)
  conditions!: SalesDocumentConditionDto[];

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string | null;

  @ApiProperty({
    required: false,
    description: 'The rule being edited, so it is never reported as colliding with itself',
  })
  @IsOptional()
  @IsString()
  excludeRuleId?: string;
}

class SalesDocumentOverlapHitDto {
  @ApiProperty() ruleId!: string;
  @ApiProperty() connectionId!: string;
  @ApiProperty() documentKind!: string;
}

class SalesDocumentDisjointHitDto {
  @ApiProperty() ruleId!: string;
  @ApiProperty({ enum: SalesDocumentOverlapDisjointReasonValues }) reason!: string;
}

class SalesDocumentUndecidedHitDto {
  @ApiProperty() ruleId!: string;
  @ApiProperty({ enum: SalesDocumentOverlapUndecidedReasonValues }) reason!: string;
}

export class SalesDocumentRuleOverlapResponseDto {
  @ApiProperty({
    type: [SalesDocumentOverlapHitDto],
    description:
      'Rules that could match the same order. Non-empty means two rules would hold the order instead of one winning.',
  })
  overlapping!: SalesDocumentOverlapHitDto[];

  @ApiProperty({
    type: [SalesDocumentDisjointHitDto],
    description: 'Rules that provably cannot match the same order, each with the reason.',
  })
  disjoint!: SalesDocumentDisjointHitDto[];

  @ApiProperty({
    type: [SalesDocumentUndecidedHitDto],
    description:
      'Rules this build could not decide about. Surfaced rather than dropped: silence would read as "no conflict".',
  })
  undecided!: SalesDocumentUndecidedHitDto[];

  static fromDomain(verdict: SalesDocumentRuleOverlapVerdict): SalesDocumentRuleOverlapResponseDto {
    const dto = new SalesDocumentRuleOverlapResponseDto();
    dto.overlapping = verdict.overlapping.map((hit) => ({ ...hit }));
    dto.disjoint = verdict.disjoint.map((hit) => ({ ...hit }));
    dto.undecided = verdict.undecided.map((hit) => ({ ...hit }));
    return dto;
  }
}
