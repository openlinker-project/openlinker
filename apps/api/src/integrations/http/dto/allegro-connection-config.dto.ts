/**
 * Allegro Connection Config DTO
 *
 * Request DTO for Allegro connection configuration. Validates Allegro-specific
 * config fields (environment, apiBaseUrl, sellerDefaults) and provides Swagger
 * documentation.
 *
 * @module apps/api/src/integrations/http/dto
 */
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AllegroSafetyInformationTypeValues,
  PolishVoivodeshipValues,
} from '@openlinker/integrations-allegro';

/**
 * Allegro environment values
 */
export enum AllegroEnvironment {
  SANDBOX = 'sandbox',
  PRODUCTION = 'production',
}

/**
 * Allegro ship-from address. `countryCode` is pinned to `'PL'` for now —
 * multi-market support is out of scope for #430. The voivodeship enum is
 * Allegro's own (16 values) and the postcode regex matches the PL format.
 */
export class AllegroSellerLocationDto {
  @ApiProperty({ description: 'ISO country code', enum: ['PL'], example: 'PL' })
  @IsIn(['PL'])
  countryCode!: 'PL';

  @ApiProperty({
    description: 'Polish voivodeship (Allegro enum)',
    enum: PolishVoivodeshipValues,
  })
  @IsIn(PolishVoivodeshipValues as readonly string[])
  province!: (typeof PolishVoivodeshipValues)[number];

  @ApiProperty({ description: 'City name', example: 'Warszawa' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  city!: string;

  @ApiProperty({ description: 'PL postcode (NN-NNN)', example: '00-001' })
  @IsString()
  @Matches(/^\d{2}-\d{3}$/, {
    message: 'postCode must match the PL format NN-NNN',
  })
  postCode!: string;
}

/**
 * EU GPSR safety-information payload. Discriminated by `type` — when
 * `SAFETY_INFORMATION`, `content` is required free text.
 */
export class AllegroSafetyInformationDto {
  @ApiProperty({
    description: 'Safety-information discriminator',
    enum: AllegroSafetyInformationTypeValues,
  })
  @IsIn(AllegroSafetyInformationTypeValues as readonly string[])
  type!: (typeof AllegroSafetyInformationTypeValues)[number];

  @ApiPropertyOptional({
    description:
      'Free-text safety information content. Required when `type === SAFETY_INFORMATION`.',
    maxLength: 2000,
  })
  // Conditional require: when `type === SAFETY_INFORMATION`, `content` must
  // be a non-empty string. Otherwise the field is ignored entirely (every
  // subsequent validator is skipped by `@ValidateIf`).
  @ValidateIf((o: AllegroSafetyInformationDto) => o.type === 'SAFETY_INFORMATION')
  @IsString()
  @IsNotEmpty({
    message: 'safetyInformation.content is required when type is SAFETY_INFORMATION',
  })
  @MaxLength(2000)
  content?: string;
}

export class AllegroSellerDefaultsDto {
  @ApiProperty({ description: 'Ship-from location', type: () => AllegroSellerLocationDto })
  @ValidateNested()
  @Type(() => AllegroSellerLocationDto)
  @IsObject()
  location!: AllegroSellerLocationDto;

  @ApiProperty({
    description:
      'Allegro responsible-producer id from `/sale/responsible-producers` registry',
  })
  @IsString()
  @IsNotEmpty()
  responsibleProducerId!: string;

  @ApiProperty({
    description: 'EU GPSR safety information',
    type: () => AllegroSafetyInformationDto,
  })
  @ValidateNested()
  @Type(() => AllegroSafetyInformationDto)
  @IsObject()
  safetyInformation!: AllegroSafetyInformationDto;
}

/**
 * Allegro Connection Config DTO
 *
 * Configuration for an Allegro connection. Environment is required;
 * apiBaseUrl is optional and defaults based on environment.
 *
 * Declared after the nested DTOs because `emitDecoratorMetadata` resolves
 * the property type eagerly at decorator-evaluation time — referencing
 * `AllegroSellerDefaultsDto` from a class declared above it triggers a
 * temporal-dead-zone error when the file is loaded by the service layer.
 */
export class AllegroConnectionConfigDto {
  @ApiProperty({
    description: 'Allegro environment (sandbox or production)',
    enum: AllegroEnvironment,
    example: AllegroEnvironment.SANDBOX,
  })
  @IsEnum(AllegroEnvironment)
  environment!: AllegroEnvironment;

  @ApiPropertyOptional({
    description:
      'Allegro API base URL (optional, defaults based on environment). ' +
      'Sandbox: https://api.allegro.pl.allegrosandbox.pl, Production: https://api.allegro.pl. ' +
      'Note: OAuth authorization endpoints use https://allegro.pl.allegrosandbox.pl/auth/oauth/* (different base URL)',
    example: 'https://api.allegro.pl.allegrosandbox.pl',
  })
  @IsUrl({ require_tld: false })
  @IsOptional()
  @IsString()
  apiBaseUrl?: string;

  @ApiPropertyOptional({
    description: 'Master catalog connection ID for barcode lookups',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4', { message: 'masterCatalogConnectionId must be a valid UUID' })
  @IsOptional()
  masterCatalogConnectionId?: string;

  @ApiPropertyOptional({
    description:
      'Connection-level seller defaults required by `POST /sale/product-offers` ' +
      '— `location` (every offer), plus `responsibleProducerId` and ' +
      '`safetyInformation` for the inline-product path. See #430.',
    type: () => AllegroSellerDefaultsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AllegroSellerDefaultsDto)
  sellerDefaults?: AllegroSellerDefaultsDto;
}
