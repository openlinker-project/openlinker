/**
 * InPost Connection Config DTO
 *
 * Application-layer `class-validator` schema for the InPost `Connection.config`
 * blob. Plugin-private — only `InpostConnectionConfigShapeValidatorAdapter`
 * (registered with the host at boot) reaches into it; the API-layer
 * `ConnectionService` invokes the validator via the registry and never touches
 * this DTO directly. Sibling-context value (`InpostEnvironmentValues`) imported
 * relatively to avoid a self-package `dist/` cycle (mirrors the Allegro DTO).
 *
 * @module libs/integrations/inpost/src/application/dto
 */
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InpostEnvironmentValues } from '../../domain/types/inpost-config.types';

export class InpostAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  street!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  buildingNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  city!: string;

  @IsString()
  @Matches(/^\d{2}-\d{3}$/, { message: 'postCode must match the PL format NN-NNN' })
  postCode!: string;

  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be an ISO 3166-1 alpha-2 code' })
  countryCode!: string;
}

export class InpostSenderContactDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  name?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone!: string;

  @ValidateNested()
  @Type(() => InpostAddressDto)
  @IsObject()
  address!: InpostAddressDto;
}

export class InpostConnectionConfigDto {
  @IsIn(InpostEnvironmentValues as readonly string[])
  environment!: (typeof InpostEnvironmentValues)[number];

  @IsString()
  @IsNotEmpty()
  organizationId!: string;

  @ValidateNested()
  @Type(() => InpostSenderContactDto)
  @IsObject()
  senderAddress!: InpostSenderContactDto;
}
