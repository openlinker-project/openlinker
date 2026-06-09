/**
 * DPD Connection Config Shape Validator Adapter
 *
 * Implements `ConnectionConfigShapeValidatorPort` for the DPD adapter. Runs
 * `class-validator` against `DpdConnectionConfigDto` and throws
 * `InvalidConnectionConfigException` carrying the flattened error list on
 * failure. The host's `ConnectionService` maps that to `BadRequestException`
 * at the API boundary — the plugin never depends on `@nestjs/common`.
 *
 * Registered with `host.connectionConfigShapeValidatorRegistry` at boot via
 * `createDpdPlugin().register(host)`.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ConnectionConfigShapeValidatorPort } from '@openlinker/core/integrations';
import {
  InvalidConnectionConfigException,
  flattenValidationErrors,
} from '@openlinker/core/integrations';
import { DpdConnectionConfigDto } from '../../application/dto/dpd-connection-config.dto';

export class DpdConnectionConfigShapeValidatorAdapter implements ConnectionConfigShapeValidatorPort {
  constructor(private readonly pluginName: string = 'DPD Polska') {}

  async validate(config: Record<string, unknown>): Promise<void> {
    const instance = plainToInstance(DpdConnectionConfigDto, config);
    // `whitelist: false` — the persisted config may carry adjacent keys outside
    // this DTO; validate shape on what the DTO describes, not exhaustive
    // ownership of the blob.
    const errors = await validate(instance, { whitelist: false, forbidNonWhitelisted: false });
    if (errors.length > 0) {
      throw new InvalidConnectionConfigException(this.pluginName, flattenValidationErrors(errors));
    }
  }
}
