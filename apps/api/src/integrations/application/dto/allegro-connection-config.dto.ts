/**
 * Allegro Connection Config DTO
 *
 * Application-layer schema for the Allegro `Connection.config` blob.
 * Lives in the application layer (not `http/dto/`) because the schema is
 * the source of truth for `ConnectionService.update()`'s server-side
 * re-validation pass — see #437. The HTTP controller hooks into the same
 * shape but does not own it. Swagger decorators are kept on the class so
 * the DTO can be referenced from a controller @Body() in the future
 * without splitting the schema in two.
 *
 * @module apps/api/src/integrations/application/dto
 */
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
 * Single attachment reference for the `ATTACHMENTS` safety-info variant.
 * `id` is the upload-reference returned by Allegro's attachment-upload
 * endpoint (out of scope for #445; the upload UI / adapter call will be
 * a follow-up).
 */
export class AllegroSafetyAttachmentDto {
  @ApiProperty({
    description: 'Allegro attachment id (UUID returned by attachment upload)',
  })
  @IsString()
  @IsNotEmpty()
  id!: string;
}

/**
 * EU GPSR safety-information payload. Discriminated by `type` — three
 * variants:
 * - `NO_SAFETY_INFORMATION` — no extra fields
 * - `TEXT` — `description` required (1–5000 chars per Allegro)
 * - `ATTACHMENTS` — `attachments` required (1–20 entries per Allegro)
 *
 * Shape verified against Allegro Developer Portal (#445); see
 * `AllegroSafetyInformation` in
 * `libs/integrations/allegro/src/domain/types/allegro-seller-defaults.types.ts`
 * for the canonical type and source links.
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
      'Free-text safety information. Required when `type === TEXT`. ' +
      'Allegro accepts 1–5000 characters; no HTML, newlines allowed.',
    minLength: 1,
    maxLength: 5000,
  })
  // Conditional require: only enforced when `type === 'TEXT'`. Every
  // subsequent validator is skipped on the other discriminator branches.
  @ValidateIf((o: AllegroSafetyInformationDto) => o.type === 'TEXT')
  @IsString()
  @IsNotEmpty({
    message: 'safetyInformation.description is required when type is TEXT',
  })
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Attachment references for the `ATTACHMENTS` safety-info variant. ' +
      'Required when `type === ATTACHMENTS`. Allegro accepts 1–20 attachments per product.',
    type: () => [AllegroSafetyAttachmentDto],
  })
  @ValidateIf((o: AllegroSafetyInformationDto) => o.type === 'ATTACHMENTS')
  @IsArray()
  @ArrayMinSize(1, {
    message: 'safetyInformation.attachments must contain at least 1 attachment when type is ATTACHMENTS',
  })
  @ArrayMaxSize(20, {
    message: 'safetyInformation.attachments cannot contain more than 20 attachments',
  })
  @ValidateNested({ each: true })
  @Type(() => AllegroSafetyAttachmentDto)
  attachments?: AllegroSafetyAttachmentDto[];
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
