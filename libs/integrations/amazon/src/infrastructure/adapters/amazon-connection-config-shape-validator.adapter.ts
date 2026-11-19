/**
 * Amazon Connection Config Shape Validator
 *
 * Refuses, at save time, a `Connection.config` the adapter could not use:
 * an unknown region or environment, no marketplace, a malformed marketplace
 * id, or a known marketplace paired with the wrong region. Delegates to
 * `parseAmazonConfig`, the same reader the factory and the tester use.
 *
 * On an update it also refuses a change of region (`regionChangeIssue`): the
 * form shows the region read-only, and this covers the raw config editor and
 * direct API calls.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters
 * @implements {ConnectionConfigShapeValidatorPort}
 */
import {
  type ConnectionConfigShapeValidatorPort,
  type ConnectionConfigValidationContext,
  type FlatValidationIssue,
  InvalidConnectionConfigException,
} from '@openlinker/core/integrations';

import { parseAmazonConfig, regionChangeIssue } from '../../domain/policies/amazon-config.policy';

export class AmazonConnectionConfigShapeValidatorAdapter implements ConnectionConfigShapeValidatorPort {
  constructor(private readonly pluginName: string = 'Amazon') {}

  validate(config: Record<string, unknown>, context?: ConnectionConfigValidationContext): Promise<void> {
    const parsed = parseAmazonConfig(config);
    const issues: FlatValidationIssue[] = parsed.ok ? [] : [...parsed.issues];
    const regionIssue = context?.previous ? regionChangeIssue(config, context.previous) : null;
    if (regionIssue !== null) {
      issues.push(regionIssue);
    }
    if (issues.length === 0) {
      return Promise.resolve();
    }
    return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
  }
}
