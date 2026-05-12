/**
 * Allegro Connection Config Shape Validator Adapter (#587)
 *
 * Implements `ConnectionConfigShapeValidatorPort` for the Allegro adapter.
 * Runs `class-validator` against `AllegroConnectionConfigDto` and throws
 * `InvalidConnectionConfigException` carrying the flattened error list on
 * failure. The host's `ConnectionService` maps that to `BadRequestException`
 * at the API boundary — plugins don't depend on `@nestjs/common` for the
 * failure path.
 *
 * Registered with `host.connectionConfigShapeValidatorRegistry` at boot
 * via `AllegroIntegrationModule.onModuleInit` → `plugin.register(host)`.
 *
 * `pluginName` is injected via the constructor (sourced from the plugin
 * descriptor's brand constant) so the exception's display label stays
 * co-located with the manifest rather than hardcoded here.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ConnectionConfigShapeValidatorPort,
  InvalidConnectionConfigException,
  flattenValidationErrors,
} from '@openlinker/core/integrations';
import { AllegroConnectionConfigDto } from '../../application/dto/allegro-connection-config.dto';

export class AllegroConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'Allegro') {}

  async validate(config: Record<string, unknown>): Promise<void> {
    const instance = plainToInstance(AllegroConnectionConfigDto, config);
    // `whitelist: false` because the persisted `config` may carry adjacent
    // keys (e.g. future per-platform tunables) that aren't part of the
    // DTO — we want shape-correctness on what the DTO *does* describe,
    // not exhaustive ownership of the JSONB blob.
    const errors = await validate(instance, {
      whitelist: false,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      throw new InvalidConnectionConfigException(this.pluginName, flattenValidationErrors(errors));
    }
  }
}
