/**
 * Shoper Connection Config Shape Validator Adapter
 *
 * Implements `ConnectionConfigShapeValidatorPort` for Shoper. Applies the
 * shared `parseShoperBaseUrl` rule to `config.baseUrl` and throws
 * `InvalidConnectionConfigException` carrying every issue on failure; the
 * host's `ConnectionService` maps that to a 400 at the API boundary.
 *
 * Inline checks rather than a class-validator DTO: the shape is one string and
 * the rule is a pure function the connection tester reuses.
 *
 * Only `baseUrl` is validated; the persisted config may carry adjacent keys
 * (`rateLimit`, `stockSafetyBuffer`, ...) that are not this plugin's to police.
 *
 * Registered with `host.connectionConfigShapeValidatorRegistry` via
 * `createShoperPlugin().register(host)`.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import type { ConnectionConfigShapeValidatorPort } from '@openlinker/core/integrations';
import { InvalidConnectionConfigException } from '@openlinker/core/integrations';

import { parseShoperBaseUrl } from '../../domain/policies/shoper-base-url.policy';

export class ShoperConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string) {}

  validate(config: Record<string, unknown>): Promise<void> {
    const parsed = parseShoperBaseUrl(config.baseUrl);
    if (!parsed.ok) {
      return Promise.reject(
        new InvalidConnectionConfigException(
          this.pluginName,
          parsed.issues.map((message) => ({ path: 'baseUrl', message })),
        ),
      );
    }
    return Promise.resolve();
  }
}
