/**
 * Shopify Connection Credentials Shape Validator
 *
 * A connection needs one of: a pre-issued `accessToken`, the app's
 * `clientId` + `clientSecret` (client-credentials grant), or a complete OAuth
 * install blob. Same rule as the token provider (`resolveShopifyCredentialMode`).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { ConnectionCredentialsShapeValidatorPort } from '@openlinker/core/integrations';
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';

import { resolveShopifyCredentialMode } from '../../domain/policies/shopify-credentials.policy';

export class ShopifyConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string) {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    return resolveShopifyCredentialMode(credentials) !== null
      ? Promise.resolve()
      : Promise.reject(
          new InvalidCredentialsShapeException(
            this.pluginName,
            'must include a non-empty `accessToken`, or both `clientId` and `clientSecret` of the Shopify app',
          ),
        );
  }
}
