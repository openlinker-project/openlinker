/**
 * Shopify Connection Config Shape Validator
 *
 * Refuses, naming the field, a config the plugin could not use: a store
 * domain that is not the permanent `*.myshopify.com` host, an API version the
 * plugin does not support, a malformed location id, or a negative unmanaged
 * stock quantity. Delegates to `parseShopifyConfig`, the parser the client
 * builder uses. Whether the location EXISTS needs the shop, so the connection
 * test checks it (it has the credentials; a save does not).
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
      : Promise.reject(
          new InvalidConnectionConfigException(
            this.pluginName,
            parsed.issues.map((issue) => ({ path: issue.path, message: issue.message })),
          ),
        );
  }
}
