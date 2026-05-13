/**
 * Allegro Connection Config DTO
 *
 * Application-layer schema for the Allegro `Connection.config` blob.
 * Owned by the Allegro plugin package post-#587 — the shape is
 * plugin-private and only `AllegroConnectionConfigShapeValidatorAdapter`
 * (registered with the host at boot via `host.connectionConfigShapeValidatorRegistry`)
 * reaches into it. The API-layer `ConnectionService` invokes the adapter
 * via the registry; it never touches this DTO directly.
 *
 * Swagger decorators (`@ApiProperty`) were stripped post-#587 — the DTO
 * is no longer reachable from any `@Body()` binding (it's a private
 * shape-validation seam, not a request body). A future
 * `GET /connections/config-schema/:adapterKey` endpoint can layer Swagger
 * metadata back via a separate file mapping.
 *
 * @module libs/integrations/allegro/src/application/dto
 */
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
// Sibling-context types in same package — relative path. The published
// barrel re-exports them, but reaching for the self-package alias from
// inside the package itself creates a cycle through the compiled `dist/`.
import {
  AllegroSafetyInformationTypeValues,
} from '../../domain/types/allegro-seller-defaults.types';
import { PolishVoivodeshipValues } from '../../domain/types/allegro-location.types';
import { AllegroEnvironmentValues } from '../../domain/types/allegro-config.types';

/**
 * Allegro ship-from address. `countryCode` is pinned to `'PL'` for now —
 * multi-market support is out of scope for #430. The voivodeship enum is
 * Allegro's own (16 values) and the postcode regex matches the PL format.
 */
export class AllegroSellerLocationDto {
  @IsIn(['PL'])
  countryCode!: 'PL';
  @IsIn(PolishVoivodeshipValues as readonly string[])
  province!: (typeof PolishVoivodeshipValues)[number];
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  city!: string;
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
  @IsIn(AllegroSafetyInformationTypeValues as readonly string[])
  type!: (typeof AllegroSafetyInformationTypeValues)[number];
  // Conditional require: only enforced when `type === 'TEXT'`. Every
  // subsequent validator is skipped on the other discriminator branches.
  @ValidateIf((o: AllegroSafetyInformationDto) => o.type === 'TEXT')
  @IsString()
  @IsNotEmpty({
    message: 'safetyInformation.description is required when type is TEXT',
  })
  @MaxLength(5000)
  description?: string;
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
  @ValidateNested()
  @Type(() => AllegroSellerLocationDto)
  @IsObject()
  location!: AllegroSellerLocationDto;
  @IsString()
  @IsNotEmpty()
  responsibleProducerId!: string;
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
  @IsIn(AllegroEnvironmentValues as readonly string[])
  environment!: (typeof AllegroEnvironmentValues)[number];
  @IsUrl({ require_tld: false })
  @IsOptional()
  @IsString()
  apiBaseUrl?: string;
  @IsUUID('4', { message: 'masterCatalogConnectionId must be a valid UUID' })
  @IsOptional()
  masterCatalogConnectionId?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => AllegroSellerDefaultsDto)
  sellerDefaults?: AllegroSellerDefaultsDto;
}
