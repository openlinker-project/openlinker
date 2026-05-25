/**
 * InPost Connection Config Shape Validator Adapter
 *
 * Implements `ConnectionConfigShapeValidatorPort` for the InPost adapter.
 * Runs `class-validator` against `InpostConnectionConfigDto` and throws
 * `InvalidConnectionConfigException` carrying the flattened error list on
 * failure. The host's `ConnectionService` maps that to `BadRequestException`
 * at the API boundary — the plugin never depends on `@nestjs/common`.
 *
 * Registered with `host.connectionConfigShapeValidatorRegistry` at boot via
 * `createInpostPlugin().register(host)`.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ConnectionConfigShapeValidatorPort } from '@openlinker/core/integrations';
import {
  InvalidConnectionConfigException,
  flattenValidationErrors,
} from '@openlinker/core/integrations';
import { InpostConnectionConfigDto } from '../../application/dto/inpost-connection-config.dto';

export class InpostConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'InPost') {}

  async validate(config: Record<string, unknown>): Promise<void> {
    const instance = plainToInstance(InpostConnectionConfigDto, config);
    // `whitelist: false` — the persisted config may carry adjacent keys
    // (e.g. future `psModuleChoice`) outside this DTO; validate shape on what
    // the DTO describes, not exhaustive ownership of the blob.
    const errors = await validate(instance, { whitelist: false, forbidNonWhitelisted: false });
    if (errors.length > 0) {
      throw new InvalidConnectionConfigException(this.pluginName, flattenValidationErrors(errors));
    }
  }
}
