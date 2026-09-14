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
  isCurrencyCode,
  isDecimalAmountString,
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

  /**
   * The amount an `orderTotalGross` condition compares against (#3189), as a
   * DECIMAL STRING — `'450.00'`, never a JSON number. The value is persisted in
   * jsonb and shown back to the operator verbatim, and a JSON number cannot
   * round-trip `450.10` as itself. `toDomain` rejects anything the core guard
   * would not accept, so a malformed amount is a 400 here rather than a rule
   * that saves and silently never matches.
   */
  @ApiProperty({ required: false, example: '450.00' })
  @IsOptional()
  @IsString()
  amount?: string;

  /**
   * The currency that amount is expressed in (#3189), ISO 4217 uppercase. Never
   * converted: a rule written in one currency does not match an order priced in
   * another, and a second currency is a second rule.
   */
  @ApiProperty({ required: false, example: 'PLN' })
  @IsOptional()
  @IsString()
  currency?: string;

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
    // Narrowed through the CORE guards rather than re-stated here, so
    // "authorable over HTTP" and "evaluable by the engine" cannot diverge: a
    // shape this DTO accepted but `isSalesDocumentCondition` rejected would
    // persist a rule that reads as "never matches" with nothing said to the
    // operator.
    if (!isDecimalAmountString(dto.amount)) {
      throw new BadRequestException(
        `Condition field "orderTotalGross" requires "amount" as a decimal string, e.g. "450.00"`,
      );
    }
    if (!isCurrencyCode(dto.currency)) {
      throw new BadRequestException(
        `Condition field "orderTotalGross" requires "currency" as a 3-letter ISO 4217 code, e.g. "PLN"`,
      );
    }
    return { field: 'orderTotalGross', op: dto.op, amount: dto.amount, currency: dto.currency };
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
      dto.amount = condition.amount;
      dto.currency = condition.currency;
    }
    return dto;
  }
}
