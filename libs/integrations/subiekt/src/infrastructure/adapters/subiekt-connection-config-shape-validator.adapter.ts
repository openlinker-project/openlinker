/**
 * Subiekt Connection Config Shape Validator Adapter (#753)
 *
 * Implements `ConnectionConfigShapeValidatorPort`. Runs class-validator against
 * `SubiektConnectionConfigDto` and throws `InvalidConnectionConfigException`
 * carrying the flattened error list on failure. Registered with
 * `host.connectionConfigShapeValidatorRegistry` at boot. Mirrors the WooCommerce
 * / PrestaShop validator.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ConnectionConfigShapeValidatorPort } from '@openlinker/core/integrations';
import {
  InvalidConnectionConfigException,
  flattenValidationErrors,
} from '@openlinker/core/integrations';
import { SubiektConnectionConfigDto } from '../../application/dto/subiekt-connection-config.dto';

export class SubiektConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'Subiekt') {}

  async validate(config: Record<string, unknown>): Promise<void> {
    const instance = plainToInstance(SubiektConnectionConfigDto, config);
    // `whitelist: false` — the persisted config may carry adjacent keys from
    // future releases; validate the shape the DTO describes, not exhaustive
    // ownership of the JSONB blob.
    const errors = await validate(instance, { whitelist: false, forbidNonWhitelisted: false });
    if (errors.length > 0) {
      throw new InvalidConnectionConfigException(this.pluginName, flattenValidationErrors(errors));
    }
  }
}
