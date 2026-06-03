/**
 * DPD Polska Connection Config DTO
 *
 * Application-layer `class-validator` schema for the DPD `Connection.config`
 * blob. Plugin-private — only `DpdConnectionConfigShapeValidatorAdapter`
 * (registered with the host at boot) reaches into it; the API-layer
 * `ConnectionService` invokes the validator via the registry and never touches
 * this DTO directly. Sibling-context value (`DpdEnvironmentValues`) imported
 * relatively to avoid a self-package `dist/` cycle (mirrors the InPost DTO).
 *
 * Field length caps mirror the DPD `SenderOrReceiver` OpenAPI constraints.
 * `login` / `password` are the secret half and are validated at adapter
 * construction (the factory), not here.
 *
 * @module libs/integrations/dpd-polska/src/application/dto
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
import { DpdEnvironmentValues } from '../../domain/types/dpd-config.types';

export class DpdSenderContactDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  company?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  address!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  city!: string;

  @IsString()
  @Matches(/^\d{2}-\d{3}$/, { message: 'postalCode must match the PL format NN-NNN' })
  postalCode!: string;

  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be an ISO 3166-1 alpha-2 code' })
  countryCode!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;
}

export class DpdConnectionConfigDto {
  @IsIn(DpdEnvironmentValues as readonly string[])
  environment!: (typeof DpdEnvironmentValues)[number];

  @IsString()
  @Matches(/^\d+$/, { message: 'payerFid must be a numeric string' })
  payerFid!: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d+$/, { message: 'masterFid must be a numeric string' })
  masterFid?: string;

  @ValidateNested()
  @Type(() => DpdSenderContactDto)
  @IsObject()
  senderAddress!: DpdSenderContactDto;
}
