/**
 * Connection Config Validators
 *
 * Per-platform validators for `Connection.config` JSONB blobs. Each validator
 * runs `plainToInstance` + `validate` against the platform's application-layer
 * DTO and throws `BadRequestException` with flattened errors on failure.
 *
 * Used by `ConnectionService.update()` to close the DTO bypass at the
 * controller boundary (where `UpdateConnectionDto.config: Record<string,
 * unknown>` erases the typed shape). See #437.
 *
 * Adding a new platform: write a validator function and register it in
 * `CONNECTION_CONFIG_VALIDATORS` keyed by `platformType`. No changes to
 * `ConnectionService` are needed.
 *
 * @module apps/api/src/integrations/application/services/util
 */
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AllegroConnectionConfigDto } from '../../dto/allegro-connection-config.dto';
import { PrestashopConnectionConfigDto } from '../../dto/prestashop-connection-config.dto';
import { flattenValidationErrors } from './flatten-validation-errors';

export type ConnectionConfigValidator = (config: Record<string, unknown>) => Promise<void>;

async function validateAllegroConnectionConfig(config: Record<string, unknown>): Promise<void> {
  const instance = plainToInstance(AllegroConnectionConfigDto, config);
  // `whitelist: false` because the persisted `config` may carry adjacent keys
  // (e.g. future per-platform tunables) that aren't part of the DTO — we want
  // shape-correctness on what the DTO *does* describe, not exhaustive
  // ownership of the JSONB blob.
  const errors = await validate(instance, {
    whitelist: false,
    forbidNonWhitelisted: false,
  });
  if (errors.length > 0) {
    throw new BadRequestException({
      message: 'Invalid Allegro connection config',
      errors: flattenValidationErrors(errors),
    });
  }
}

async function validatePrestashopConnectionConfig(config: Record<string, unknown>): Promise<void> {
  const instance = plainToInstance(PrestashopConnectionConfigDto, config);
  // Same `whitelist: false` rationale as the Allegro validator above —
  // shape-correctness on what the DTO describes, not exhaustive ownership
  // of the JSONB blob.
  const errors = await validate(instance, {
    whitelist: false,
    forbidNonWhitelisted: false,
  });
  if (errors.length > 0) {
    throw new BadRequestException({
      message: 'Invalid PrestaShop connection config',
      errors: flattenValidationErrors(errors),
    });
  }
}

export const CONNECTION_CONFIG_VALIDATORS: Record<string, ConnectionConfigValidator> = {
  allegro: validateAllegroConnectionConfig,
  prestashop: validatePrestashopConnectionConfig,
};
