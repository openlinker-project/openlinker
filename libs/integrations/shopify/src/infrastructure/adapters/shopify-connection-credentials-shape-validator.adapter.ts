/**
 * Shopify Connection Credentials Shape Validator
 *
 * A connection needs EITHER a pre-issued `accessToken` OR both `clientId` and
 * `clientSecret` (client-credentials grant).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { ConnectionCredentialsShapeValidatorPort } from '@openlinker/core/integrations';
import { InvalidCredentialsShapeException } from '@openlinker/core/integrations';

function filled(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export class ShopifyConnectionCredentialsShapeValidatorAdapter
  implements ConnectionCredentialsShapeValidatorPort
{
  constructor(private readonly pluginName: string) {}

  validate(credentials: Record<string, unknown>): Promise<void> {
    if (filled(credentials.accessToken) || (filled(credentials.clientId) && filled(credentials.clientSecret))) {
      return Promise.resolve();
    }
    return Promise.reject(
      new InvalidCredentialsShapeException(
        this.pluginName,
        'must include a non-empty `accessToken`, or both `clientId` and `clientSecret` of the Shopify app',
      ),
    );
  }
}
