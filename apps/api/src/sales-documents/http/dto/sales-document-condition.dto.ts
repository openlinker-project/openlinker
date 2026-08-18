/**
 * Sales-Document Condition DTO (#2170)
 *
 * Request/response shape for one entry of a rule's `conditions` array.
 * Deliberately permissive at the class-validator layer (a discriminated union
 * is awkward to express with decorators) — the core service is the real gate:
 * `computeSalesDocumentConditionsHash` / `isSalesDocumentCondition` reject a
 * malformed condition before it can influence a resolve.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  SalesDocumentConditionFieldValues,
  SalesDocumentThresholdComparisonOpValues,
  type SalesDocumentCondition,
} from '@openlinker/core/sales-documents';

export class SalesDocumentConditionDto {
  @ApiProperty({ enum: SalesDocumentConditionFieldValues })
  @IsIn(SalesDocumentConditionFieldValues)
  field!: SalesDocumentCondition['field'];

  @ApiProperty({ enum: ['eq', ...SalesDocumentThresholdComparisonOpValues] })
  @IsIn(['eq', ...SalesDocumentThresholdComparisonOpValues])
  op!: 'eq' | 'gte' | 'lt';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  boolValue?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  stringValue?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  thresholdRef?: string;

  static toDomain(dto: SalesDocumentConditionDto): SalesDocumentCondition {
    if (dto.field === 'buyerHasTaxId') {
      return { field: 'buyerHasTaxId', op: 'eq', value: Boolean(dto.boolValue) };
    }
    if (dto.field === 'orderCountry') {
      return { field: 'orderCountry', op: 'eq', value: dto.stringValue ?? '' };
    }
    return {
      field: 'orderTotalGross',
      op: dto.op === 'gte' ? 'gte' : 'lt',
      thresholdRef: dto.thresholdRef ?? '',
    };
  }

  static fromDomain(condition: SalesDocumentCondition): SalesDocumentConditionDto {
    const dto = new SalesDocumentConditionDto();
    dto.field = condition.field;
    dto.op = condition.op;
    if (condition.field === 'buyerHasTaxId') {
      dto.boolValue = condition.value;
    } else if (condition.field === 'orderCountry') {
      dto.stringValue = condition.value;
    } else {
      dto.thresholdRef = condition.thresholdRef;
    }
    return dto;
  }
}
