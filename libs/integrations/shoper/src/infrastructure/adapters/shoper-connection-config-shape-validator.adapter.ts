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
    const issues: Array<{ path: string; message: string }> = [];
    const parsed = parseShoperBaseUrl(config.baseUrl);
    if (!parsed.ok) {
      issues.push(...parsed.issues.map((message) => ({ path: 'baseUrl', message })));
    }
    issues.push(...validateDefaults(config.defaults));
    issues.push(...validateCallbackBaseUrl(config.openlinkerCallbackBaseUrl));
    return issues.length > 0
      ? Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues))
      : Promise.resolve();
  }
}

const DEFAULT_KEYS = ['shippingId', 'paymentId', 'statusId'] as const;

/** `defaults` is optional; when present each id must be a positive integer (an unset key is `null`/absent). */
function validateDefaults(defaults: unknown): Array<{ path: string; message: string }> {
  if (defaults === undefined || defaults === null) {
    return [];
  }
  if (typeof defaults !== 'object' || Array.isArray(defaults)) {
    return [{ path: 'defaults', message: 'must be an object' }];
  }
  const record = defaults as Record<string, unknown>;
  return DEFAULT_KEYS.flatMap((key) => {
    const value = record[key];
    if (value === undefined || value === null) {
      return [];
    }
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isInteger(n) && n > 0
      ? []
      : [{ path: `defaults.${key}`, message: 'must be a positive integer (an id from the shop)' }];
  });
}

/** Absent or blank is fine (the webhook install then asks for it); a present value must be an http(s) URL. */
function validateCallbackBaseUrl(value: unknown): Array<{ path: string; message: string }> {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  const path = 'openlinkerCallbackBaseUrl';
  if (typeof value !== 'string') {
    return [{ path, message: 'must be a string' }];
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? []
      : [{ path, message: 'must use http:// or https://' }];
  } catch {
    return [{ path, message: 'must be a valid URL' }];
  }
}
