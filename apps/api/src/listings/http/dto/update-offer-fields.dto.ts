/**
 * Update Offer Fields DTOs
 *
 * Request DTO for POST /connections/:connectionId/offers/:offerId/fields.
 * At least one of price, title, or description must be present.
 *
 * @module apps/api/src/listings/http/dto
 */
import type { ValidationOptions, ValidationArguments } from 'class-validator';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  IsArray,
  IsIn,
  MaxLength,
  registerDecorator,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OfferPriceDto {
  @ApiProperty({ example: '99.99' })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ example: 'PLN' })
  @IsString()
  @IsNotEmpty()
  currency!: string;
}

export class AllegroDescriptionSectionItemDto {
  @ApiProperty({ enum: ['TEXT'] })
  @IsIn(['TEXT'])
  type!: 'TEXT';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class AllegroDescriptionSectionDto {
  @ApiProperty({ type: [AllegroDescriptionSectionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllegroDescriptionSectionItemDto)
  items!: AllegroDescriptionSectionItemDto[];
}

export class OfferDescriptionDto {
  @ApiProperty({ type: [AllegroDescriptionSectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllegroDescriptionSectionDto)
  sections!: AllegroDescriptionSectionDto[];
}

function AtLeastOneField(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'atLeastOneField',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const obj = args.object as Record<string, unknown>;
          return (
            obj['price'] !== undefined ||
            obj['title'] !== undefined ||
            obj['description'] !== undefined
          );
        },
        defaultMessage(): string {
          return 'At least one of price, title, or description must be provided';
        },
      },
    });
  };
}

export class UpdateOfferFieldsDto {
  @ApiPropertyOptional({ type: OfferPriceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OfferPriceDto)
  @AtLeastOneField()
  price?: OfferPriceDto;

  @ApiPropertyOptional({ maxLength: 75 })
  @IsOptional()
  @IsString()
  @MaxLength(75)
  title?: string;

  @ApiPropertyOptional({ type: OfferDescriptionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OfferDescriptionDto)
  description?: OfferDescriptionDto;

  /*
   * Deliberately NO `taxRate` here (ADR-052).
   *
   * `OfferFieldUpdate.taxRate` is a real part of the neutral contract and both
   * marketplace adapters write it, but the producer must be OpenLinker
   * propagating the rate the shop catalogue carries - never a value an operator
   * typed. A rate typed here would be a fourth authority that no master and no
   * channel can be corrected from: it is journalled nowhere, it cannot be
   * attributed in a mismatch investigation, and the real remedy for a wrong
   * rate is fixing the shop record the whole chain reads from. The global
   * `forbidNonWhitelisted` validation pipe therefore rejects a `taxRate` key on
   * this route with a 400 rather than patching it onto the live offer.
   */
}

export class UpdateOfferFieldsResponseDto {
  @ApiProperty()
  jobId!: string;
}
