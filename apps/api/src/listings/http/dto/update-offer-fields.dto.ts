/**
 * Update Offer Fields DTOs
 *
 * Request DTO for POST /connections/:connectionId/offers/:offerId/fields.
 * At least one of price, title, or description must be present.
 *
 * @module apps/api/src/listings/http/dto
 */
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  IsArray,
  IsIn,
  MaxLength,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
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
          return obj['price'] !== undefined || obj['title'] !== undefined || obj['description'] !== undefined;
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
}

export class UpdateOfferFieldsResponseDto {
  @ApiProperty()
  jobId!: string;
}
