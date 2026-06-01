/**
 * WooCommerce Connection Credentials Shape Validator Adapter
 *
 * Implements `ConnectionCredentialsShapeValidatorPort` for the WooCommerce
 * adapter. Verifies the raw credentials payload includes non-empty
 * `consumerKey` and `consumerSecret` strings before persistence.
 *
 * Uses inline checks rather than a class-validator DTO — the same pattern as
 * PrestaShop's credentials validator — because the shape is two non-empty
 * strings and a DTO would add boilerplate with no real benefit.
 *
 * Registered with `host.connectionCredentialsShapeValidatorRegistry` at boot
 * via `createWooCommercePlugin().register(host)`.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @implements {ConnectionCredentialsShapeValidatorPort}
 */
import type { ConnectionCredentialsShapeValidatorPort } from '@openlinker/core/integrations';
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';

export class WooCommerceConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'WooCommerce') {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    const key = credentials.consumerKey;
    if (typeof key !== 'string' || key.trim().length === 0) {
      return Promise.reject(
        new InvalidCredentialsShapeException(
          this.pluginName,
          'must include a non-empty `consumerKey` string',
        ),
      );
    }
    const secret = credentials.consumerSecret;
    if (typeof secret !== 'string' || secret.trim().length === 0) {
      return Promise.reject(
        new InvalidCredentialsShapeException(
          this.pluginName,
          'must include a non-empty `consumerSecret` string',
        ),
      );
    }
    return Promise.resolve();
  }
}
