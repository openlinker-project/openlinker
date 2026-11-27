/**
 * Amazon Connection Config Shape Validator
 *
 * Refuses, at save time, a `Connection.config` the adapter could not use:
 * an unknown region or environment, no marketplace, a malformed marketplace
 * id, or a known marketplace paired with the wrong region. Delegates to
 * `parseAmazonConfig`, the same reader the factory and the tester use.
 *
 * On an update it also refuses a change of the fields that identify the
 * seller account (`fixedAccountIssues`): the region, the environment and, in
 * `fe`, the marketplace. The form shows them read-only; this covers the raw
 * config editor and direct API calls.
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

import { fixedAccountIssues, parseAmazonConfig } from '../../domain/policies/amazon-config.policy';

export class AmazonConnectionConfigShapeValidatorAdapter implements ConnectionConfigShapeValidatorPort {
  constructor(private readonly pluginName: string = 'Amazon') {}

  validate(config: Record<string, unknown>, context?: ConnectionConfigValidationContext): Promise<void> {
    const parsed = parseAmazonConfig(config);
    const issues: FlatValidationIssue[] = parsed.ok ? [] : [...parsed.issues];
    if (context?.previous) {
      issues.push(...fixedAccountIssues(config, context.previous));
    }
    if (issues.length === 0) {
      return Promise.resolve();
    }
    return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
  }
}
