/**
 * PrestaShop Connection Config Shape Validator Adapter (#587)
 *
 * Implements `ConnectionConfigShapeValidatorPort` for the PrestaShop
 * adapter. Sibling of `AllegroConnectionConfigShapeValidatorAdapter`.
 *
 * Registered with `host.connectionConfigShapeValidatorRegistry` at boot
 * via `PrestashopIntegrationModule.onModuleInit` → `plugin.register(host)`.
 *
 * `pluginName` is injected via the constructor (sourced from the plugin
 * descriptor's brand constant) so the exception's display label stays
 * co-located with the manifest rather than hardcoded here.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ConnectionConfigShapeValidatorPort } from '@openlinker/core/integrations';
import {
  InvalidConnectionConfigException,
  flattenValidationErrors,
} from '@openlinker/core/integrations';
import { PrestashopConnectionConfigDto } from '../../application/dto/prestashop-connection-config.dto';

export class PrestashopConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'PrestaShop') {}

  async validate(config: Record<string, unknown>): Promise<void> {
    const instance = plainToInstance(PrestashopConnectionConfigDto, config);
    const errors = await validate(instance, {
      whitelist: false,
      forbidNonWhitelisted: false,
    });

    if (errors.length > 0) {
      throw new InvalidConnectionConfigException(this.pluginName, flattenValidationErrors(errors));
    }
  }
}
