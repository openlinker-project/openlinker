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
            obj['description'] !== undefined ||
            obj['taxRate'] !== undefined
          );
        },
        defaultMessage(): string {
          return 'At least one of price, title, description, or taxRate must be provided';
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

  @ApiPropertyOptional({
    description:
      'Neutral percent-as-string tax rate (#2249): "23", "8", "5", "0", "zw", "np", "oo". ' +
      'Propagates the shop\'s rate onto a LIVE offer, so an offer\'s rate follows the ' +
      'catalogue instead of freezing at whatever it was when the offer was first published. ' +
      'Omitting it means "this update does not touch the rate" — never "the product has no ' +
      'rate", so an update can never blank a rate an offer already carries. An adapter whose ' +
      'platform marks the field seller-frozen skips the write.',
    maxLength: 16,
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  taxRate?: string;
}

export class UpdateOfferFieldsResponseDto {
  @ApiProperty()
  jobId!: string;
}
