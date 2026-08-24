/**
 * Sales-Document Condition DTO (#2170)
 *
 * Request/response shape for one entry of a rule's `conditions` array.
 * Deliberately permissive at the class-validator layer (a discriminated union
 * is awkward to express with decorators) — `toDomain` is the real gate: it
 * requires the exact sub-field the discriminant `field` needs and rejects a
 * missing/wrong-typed one with a 400 rather than defaulting it to `''` /
 * `false` / a coerced `op`, which would otherwise persist an unconditional
 * "match everything" (or wrong-comparison) rule with no error anywhere.
 *
 * @module apps/api/src/sales-documents/http/dto
 */
import { BadRequestException } from '@nestjs/common';
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
      if (typeof dto.boolValue !== 'boolean') {
        throw new BadRequestException(
          `Condition field "buyerHasTaxId" requires a boolean "boolValue"`,
        );
      }
      return { field: 'buyerHasTaxId', op: 'eq', value: dto.boolValue };
    }
    if (dto.field === 'orderCountry') {
      if (typeof dto.stringValue !== 'string' || dto.stringValue.length === 0) {
        throw new BadRequestException(
          `Condition field "orderCountry" requires a non-empty "stringValue"`,
        );
      }
      return { field: 'orderCountry', op: 'eq', value: dto.stringValue };
    }
    if (dto.op !== 'gte' && dto.op !== 'lt') {
      throw new BadRequestException(
        `Condition field "orderTotalGross" requires "op" to be "gte" or "lt", got "${dto.op}"`,
      );
    }
    if (typeof dto.thresholdRef !== 'string' || dto.thresholdRef.length === 0) {
      throw new BadRequestException(
        `Condition field "orderTotalGross" requires a non-empty "thresholdRef"`,
      );
    }
    return { field: 'orderTotalGross', op: dto.op, thresholdRef: dto.thresholdRef };
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
