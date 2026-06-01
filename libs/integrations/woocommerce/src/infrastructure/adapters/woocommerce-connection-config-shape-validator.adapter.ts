/**
 * WooCommerce Connection Config Shape Validator Adapter
 *
 * Implements `ConnectionConfigShapeValidatorPort` for the WooCommerce adapter.
 * Runs `class-validator` against `WooCommerceConnectionConfigDto` and throws
 * `InvalidConnectionConfigException` carrying the flattened error list on
 * failure. The host's `ConnectionService` maps that to `BadRequestException`
 * at the API boundary — plugins never depend on `@nestjs/common`.
 *
 * Registered with `host.connectionConfigShapeValidatorRegistry` at boot via
 * `createWooCommercePlugin().register(host)`.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ConnectionConfigShapeValidatorPort } from '@openlinker/core/integrations';
import {
  InvalidConnectionConfigException,
  flattenValidationErrors,
} from '@openlinker/core/integrations';
import { WooCommerceConnectionConfigDto } from '../../application/dto/woocommerce-connection-config.dto';

export class WooCommerceConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'WooCommerce') {}

  async validate(config: Record<string, unknown>): Promise<void> {
    const instance = plainToInstance(WooCommerceConnectionConfigDto, config);
    // `whitelist: false` — the persisted config may carry adjacent keys
    // added by future releases; validate shape on what the DTO describes,
    // not exhaustive ownership of the JSONB blob.
    const errors = await validate(instance, { whitelist: false, forbidNonWhitelisted: false });
    if (errors.length > 0) {
      throw new InvalidConnectionConfigException(this.pluginName, flattenValidationErrors(errors));
    }
  }
}
