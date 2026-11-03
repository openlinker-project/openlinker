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
  Validate,
  ValidatorConstraint,
  IsNotEmpty,
  IsIn,
  IsBoolean,
  IsDefined
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BuyerTypeValues } from '@openlinker/core/invoicing';
import { BuyerTaxIdDto } from './buyer-tax-id.dto';
import { AcknowledgeWarningsProperty } from './acknowledge-warnings.dto';

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

/**
 * Optional buyer-identity override for a correction (#1582). Present only when the
 * operator is correcting the BUYER on the original document (e.g. a wrong NIP) -
 * a legally-explicit correction case (art. 106j ust. 1 pkt 5). Neutral: mirrors
 * the {@link BuyerProfile} shape the mapper already understands. Absent ⇒ the
 * original document's buyer is reused unchanged.
 */
export class CorrectionBuyerAddressDto {
  @ApiProperty({ description: 'Address line 1' })
  @IsString()
  @IsNotEmpty()
  line1!: string;

  @ApiPropertyOptional({ description: 'Address line 2', nullable: true })
  @IsOptional()
  @IsString()
  line2?: string | null;

  @ApiProperty({ description: 'City' })
  @IsString()
  @IsNotEmpty()
  city!: string;

  @ApiProperty({ description: 'Postal code' })
  @IsString()
  @IsNotEmpty()
  postalCode!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 country code' })
  @IsString()
  @IsNotEmpty()
  countryIso2!: string;
}

export class CorrectionBuyerOverrideDto {
  @ApiProperty({ description: 'Buyer name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    description: 'Scheme-tagged buyer tax id (e.g. the corrected NIP). Absent for a B2C buyer.',
    type: BuyerTaxIdDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BuyerTaxIdDto)
  taxId?: BuyerTaxIdDto;

  @ApiProperty({ type: CorrectionBuyerAddressDto, description: 'Buyer postal address' })
  @IsDefined()
  @ValidateNested()
  @Type(() => CorrectionBuyerAddressDto)
  address!: CorrectionBuyerAddressDto;

  // Inline literal union (not the imported `BuyerType` alias) so a type-only
  // import isn't dragged into decorator metadata; kept in lock-step with
  // `BuyerTypeValues` via the `@IsIn` runtime guard.
  @ApiProperty({ enum: BuyerTypeValues, description: 'Neutral B2B/B2C axis' })
  @IsIn(BuyerTypeValues)
  type!: 'company' | 'private';

  @ApiPropertyOptional({ description: 'Buyer is a public-sector / local-government entity (#1580)' })
  @IsOptional()
  @IsBoolean()
  isPublicSectorEntity?: boolean;

  @ApiPropertyOptional({ description: 'Buyer is a VAT-group member (#1580)' })
  @IsOptional()
  @IsBoolean()
  isTaxGroupMember?: boolean;
}

/** FA(3) `PrzyczynaKorekty` is a `TZnakowy` (1..256 characters). */
export const MAX_CORRECTION_REASON_LENGTH = 256;

/** Trim and collapse whitespace runs, as the XSD `token` type would read them. */
export function normalizeCorrectionReason(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Length in characters as the XSD counts them (code points), so a reason with
 * Polish diacritics or emoji is measured the way KSeF will measure it (DEF-25).
 */
@ValidatorConstraint({ name: 'maxCodePoints', async: false })
class MaxCodePointsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [max] = args.constraints as [number];
    return typeof value !== 'string' || [...value].length <= max;
  }

  defaultMessage(args: ValidationArguments): string {
    const [max] = args.constraints as [number];
    return `${args.property} must be at most ${max} characters`;
  }
}

/**
 * At least one corrected line, unless the correction changes the buyer alone
 * (DEF-24) - a wrong address on an otherwise correct invoice has no line to
 * change, and requiring a fake one made that correction impossible.
 */
@ValidatorConstraint({ name: 'linesOrBuyerOverride', async: false })
class LinesOrBuyerOverrideConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as IssueCorrectionRequestDto;
    return (Array.isArray(value) && value.length > 0) || dto.buyerOverride !== undefined;
  }

  defaultMessage(): string {
    return 'lines must contain at least one correction unless buyerOverride is present';
  }
}

export class IssueCorrectionRequestDto {
  @ApiPropertyOptional({
    description:
      'Free-text reason for the correction (e.g. wrong NIP, partial return). Strongly ' +
      'recommended - most regimes expect a correcting document to say why - but ' +
      'optional: OpenLinker suggests, the operator decides (DEF-32). Whitespace runs ' +
      'are collapsed; at most 256 characters, the FA(3) PrzyczynaKorekty limit (DEF-25). ' +
      'An empty reason is omitted from the document, never sent empty.',
    maxLength: MAX_CORRECTION_REASON_LENGTH,
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }): unknown => (typeof value === 'string' ? normalizeCorrectionReason(value) : value))
  @Validate(MaxCodePointsConstraint, [MAX_CORRECTION_REASON_LENGTH])
  reason?: string;

  @ApiProperty({
    type: [CorrectionLineDto],
    description:
      'Per-line corrections. May be empty only for a correction of the buyer alone, ' +
      'i.e. when `buyerOverride` is present (DEF-24).',
  })
  @IsArray()
  @Validate(LinesOrBuyerOverrideConstraint)
  @Validate(UniqueOriginalLineNumbersConstraint)
  @ValidateNested({ each: true })
  @Type(() => CorrectionLineDto)
  lines!: CorrectionLineDto[];

  @ApiPropertyOptional({
    description:
      'Optional buyer-identity override (e.g. a wrong NIP on the original). When ' +
      'present the correcting document is re-issued with this buyer instead of the ' +
      "original document's buyer.",
    type: CorrectionBuyerOverrideDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CorrectionBuyerOverrideDto)
  buyerOverride?: CorrectionBuyerOverrideDto;

  @ApiPropertyOptional({ description: 'Caller-supplied idempotency key for exactly-once issuance.' })
  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  @AcknowledgeWarningsProperty()
  acknowledgeWarnings?: string[];
}
