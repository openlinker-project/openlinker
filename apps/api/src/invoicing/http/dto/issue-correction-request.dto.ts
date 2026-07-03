/**
 * Issue Correction Request DTO (#1241)
 *
 * Request body for `POST /invoices/:invoiceId/correct`. Carries only the
 * caller-supplied correction fields; `connectionId` / `orderId` /
 * `originalProviderInvoiceId` are resolved server-side from the original
 * `InvoiceRecord` identified by `:invoiceId`.
 *
 * @module apps/api/src/invoicing/http/dto
 */
import type {
  ValidatorConstraintInterface,
  ValidationArguments} from 'class-validator';
import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  ArrayMinSize,
  Validate,
  ValidatorConstraint
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Rejects a correction line that changes neither quantity nor price — a no-op
 * row would be silently dropped as a KOR line with nothing to correct.
 * Mirrors the invariant documented on {@link CorrectionLine} in
 * `libs/core/src/invoicing/domain/types/invoicing.types.ts`.
 */
@ValidatorConstraint({ name: 'hasCorrectionDelta', async: false })
class HasCorrectionDeltaConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const line = args.object as CorrectionLineDto;
    return line.newQuantity !== undefined || line.newUnitPriceGross !== undefined;
  }

  defaultMessage(): string {
    return 'Each correction line must specify newQuantity and/or newUnitPriceGross';
  }
}

export class CorrectionLineDto {
  @ApiProperty({ description: '1-based line number of the original invoice line to correct.' })
  @IsNumber()
  @Min(1)
  @Validate(HasCorrectionDeltaConstraint)
  originalLineNumber!: number;

  @ApiPropertyOptional({ description: 'New quantity (post-correction). Omit to leave quantity unchanged.' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  newQuantity?: number;

  @ApiPropertyOptional({ description: 'New gross unit price (post-correction). Omit to leave price unchanged.' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  newUnitPriceGross?: number;
}

/**
 * Rejects two correction lines targeting the same `originalLineNumber` (#1297
 * review): duplicates would silently last-write-win in the persisted "after"
 * snapshot (`applyCorrectionDeltas`) while the provider may compute something
 * else — ambiguous input, so it is refused at the boundary instead.
 */
@ValidatorConstraint({ name: 'uniqueOriginalLineNumbers', async: false })
class UniqueOriginalLineNumbersConstraint implements ValidatorConstraintInterface {
  validate(lines: unknown): boolean {
    if (!Array.isArray(lines)) {
      return true; // shape errors are reported by @IsArray / @ValidateNested
    }
    const seen = new Set<number>();
    for (const line of lines as CorrectionLineDto[]) {
      if (seen.has(line?.originalLineNumber)) {
        return false;
      }
      seen.add(line?.originalLineNumber);
    }
    return true;
  }

  defaultMessage(): string {
    return 'Correction lines must not repeat the same originalLineNumber';
  }
}

export class IssueCorrectionRequestDto {
  @ApiPropertyOptional({ description: 'Free-text reason for correction (e.g. partial return).' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({ type: [CorrectionLineDto], description: 'Per-line corrections — at least one line must be present.' })
  @IsArray()
  @ArrayMinSize(1)
  @Validate(UniqueOriginalLineNumbersConstraint)
  @ValidateNested({ each: true })
  @Type(() => CorrectionLineDto)
  lines!: CorrectionLineDto[];

  @ApiPropertyOptional({ description: 'Caller-supplied idempotency key for exactly-once issuance.' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}
