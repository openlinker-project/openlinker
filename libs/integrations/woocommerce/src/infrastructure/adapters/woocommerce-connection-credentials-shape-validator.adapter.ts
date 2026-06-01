/**
 * WooCommerce Connection Credentials Shape Validator Adapter
 *
 * Implements `ConnectionCredentialsShapeValidatorPort` for the WooCommerce
 * adapter. Verifies the raw credentials payload includes non-empty
 * `consumerKey` and `consumerSecret` strings before persistence.
 *
 * Uses inline checks rather than a class-validator DTO — appropriate when
 * the shape is two non-empty strings and a DTO would add boilerplate with
 * no real benefit.
 *
 * Both fields are validated in a single pass so that an operator fixing a
 * fresh connection sees all missing fields at once rather than one at a time.
 * `InvalidCredentialsShapeException` carries a single `detail` string (the
 * signature is intentionally simpler than its config counterpart — see the
 * exception docstring), so multiple issues are joined with "; ".
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
    const issues: string[] = [];

    if (
      typeof credentials.consumerKey !== 'string' ||
      credentials.consumerKey.trim().length === 0
    ) {
      issues.push('must include a non-empty `consumerKey` string');
    }
    if (
      typeof credentials.consumerSecret !== 'string' ||
      credentials.consumerSecret.trim().length === 0
    ) {
      issues.push('must include a non-empty `consumerSecret` string');
    }

    if (issues.length > 0) {
      return Promise.reject(
        new InvalidCredentialsShapeException(this.pluginName, issues.join('; ')),
      );
    }
    return Promise.resolve();
  }
}
