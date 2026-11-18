/**
 * Amazon Connection Config Shape Validator
 *
 * Refuses, at save time, a `Connection.config` the adapter could not use:
 * an unknown region or environment, no marketplace, a malformed marketplace
 * id, or a known marketplace paired with the wrong region. Delegates to
 * `parseAmazonConfig`, the same reader the factory and the tester use.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import {
  type ConnectionConfigShapeValidatorPort,
  InvalidConnectionConfigException,
} from '@openlinker/core/integrations';

import { parseAmazonConfig } from '../../domain/policies/amazon-config.policy';

export class AmazonConnectionConfigShapeValidatorAdapter implements ConnectionConfigShapeValidatorPort {
  constructor(private readonly pluginName: string = 'Amazon') {}

  validate(config: Record<string, unknown>): Promise<void> {
    const parsed = parseAmazonConfig(config);
    if (parsed.ok) {
      return Promise.resolve();
    }
    return Promise.reject(new InvalidConnectionConfigException(this.pluginName, [...parsed.issues]));
  }
}
