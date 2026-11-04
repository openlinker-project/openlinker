/**
 * Shopify Connection Config Shape Validator
 *
 * Refuses a config the adapter could not use: a store domain that is not the
 * permanent `*.myshopify.com` host, a malformed API version, or a location id
 * that is not a Shopify Location id. Delegates to `parseShopifyConfig`, the
 * same parser the factory uses.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { ConnectionConfigShapeValidatorPort } from '@openlinker/core/integrations';
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';

import { parseShopifyConfig } from '../../domain/policies/shopify-config.policy';

export class ShopifyConnectionConfigShapeValidatorAdapter implements ConnectionConfigShapeValidatorPort {
  constructor(private readonly pluginName: string) {}

  validate(config: Record<string, unknown>): Promise<void> {
    const parsed = parseShopifyConfig(config);
    return parsed.ok
      ? Promise.resolve()
      : Promise.reject(new InvalidConnectionConfigException(this.pluginName, [...parsed.issues]));
  }
}
