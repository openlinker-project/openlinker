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
  isVatGroupMember?: boolean;
}

export class IssueCorrectionRequestDto {
  @ApiProperty({
    description:
      'Free-text reason for the correction (REQUIRED, non-empty; e.g. wrong NIP, ' +
      'partial return). Legally mandated (art. 106j ust. 2 pkt 5) and required by ' +
      'the FA(3) XSD (PrzyczynaKorekty minLength=1 when present).',
  })
  @IsString()
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  reason!: string;

  @ApiProperty({ type: [CorrectionLineDto], description: 'Per-line corrections — at least one line must be present.' })
  @IsArray()
  @ArrayMinSize(1)
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
}
