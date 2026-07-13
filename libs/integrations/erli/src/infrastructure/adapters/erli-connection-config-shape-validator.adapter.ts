/**
 * Erli Connection Config Shape Validator
 *
 * Validates the non-secret config for an Erli connection. Erli needs no
 * required config (the API key lives in credentials), so an empty config is
 * valid; the only constraint is that the optional `baseUrl` override, when
 * present, is a non-empty https URL targeting an Erli-owned host (SSRF guard —
 * the base URL carries the bearer key on every request). Registered against
 * `ConnectionConfigShapeValidatorRegistryService` at `erli.shopapi.v1`;
 * `ConnectionService` maps the thrown exception to a 400 at the API boundary.
 *
 * Also validates the optional `allegroEnvironment` selector (#1382/#1383,
 * ADR-031) — when present, it must be one of `AllegroCatalogEnvironmentValues`
 * (`'sandbox' | 'production'`), the two hosts `AllegroCategoryCatalogClient`
 * knows how to resolve.
 *
 * Hand-rolled (no class-validator) — one optional field doesn't justify a DTO
 * graph, and Erli stays dependency-light.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link ConnectionConfigShapeValidatorPort}
 */
import {
  type ConnectionConfigShapeValidatorPort,
  type FlatValidationIssue,
  InvalidConnectionConfigException,
} from '@openlinker/core/integrations';
import { ERLI_ALLOWED_BASE_URL_HOSTS, isAllowedErliHost } from '../../domain/policies/erli-base-url.policy';
import {
  AllegroCatalogEnvironmentValues,
  ErliEnvironmentValues,
} from '../../domain/types/erli-connection.types';

/**
 * UUID v4 shape, mirroring `class-validator`'s `isUUID('4')` predicate so the
 * Erli check stays consistent with Allegro's `@IsUUID('4')` posture without
 * pulling class-validator into this dependency-light hand-rolled validator.
 */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ErliConnectionConfigShapeValidatorAdapter
  implements ConnectionConfigShapeValidatorPort
{
  constructor(private readonly pluginName: string = 'Erli') {}

  validate(config: Record<string, unknown>): Promise<void> {
    const issues: FlatValidationIssue[] = [];
    const baseUrl = config.baseUrl;

    if (baseUrl !== undefined) {
      if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
        issues.push({ path: 'baseUrl', message: 'must be a non-empty string when provided' });
      } else {
        const parsed = this.parseHttpsUrl(baseUrl);
        if (!parsed) {
          issues.push({ path: 'baseUrl', message: 'must be a valid https URL' });
        } else if (!isAllowedErliHost(parsed.hostname)) {
          issues.push({
            path: 'baseUrl',
            message: `host must be ${ERLI_ALLOWED_BASE_URL_HOSTS.join(' or ')} (or a subdomain)`,
          });
        }
      }
    }

    this.validateEnvironment(config.environment, issues);
    this.validateDispatchTime(config.defaultDispatchTime, issues);
    this.validateAllegroEnvironment(config.allegroEnvironment, issues);
    this.validateAllegroCategoryAccessEnabled(config.allegroCategoryAccessEnabled, issues);
    this.validateMasterCatalogConnectionId(config.masterCatalogConnectionId, issues);

    const callbackBaseUrl = config.callbackBaseUrl;
    if (callbackBaseUrl !== undefined) {
      // http allowed (dev: host.docker.internal); only require a parseable URL.
      if (typeof callbackBaseUrl !== 'string' || callbackBaseUrl.trim().length === 0) {
        issues.push({ path: 'callbackBaseUrl', message: 'must be a non-empty string when provided' });
      } else if (!this.isHttpUrl(callbackBaseUrl)) {
        issues.push({ path: 'callbackBaseUrl', message: 'must be a valid http(s) URL' });
      }
    }

    if (issues.length > 0) {
      return Promise.reject(new InvalidConnectionConfigException(this.pluginName, issues));
    }
    return Promise.resolve();
  }

  private parseHttpsUrl(value: string): URL | null {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  private isHttpUrl(value: string): boolean {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }

  /**
   * `defaultDispatchTime`, when present, must be `{ period: non-negative int,
   * unit?: 'hour' | 'day' | 'month' }` — the shape Erli's product create
   * requires. Absent is valid (per-offer override can supply it instead).
   */
  private validateDispatchTime(value: unknown, issues: FlatValidationIssue[]): void {
    if (value === undefined) {
      return;
    }
    if (typeof value !== 'object' || value === null) {
      issues.push({ path: 'defaultDispatchTime', message: 'must be an object when provided' });
      return;
    }
    const dt = value as { period?: unknown; unit?: unknown };
    if (typeof dt.period !== 'number' || !Number.isInteger(dt.period) || dt.period < 0) {
      issues.push({
        path: 'defaultDispatchTime.period',
        message: 'must be a non-negative integer',
      });
    }
    if (dt.unit !== undefined && !['hour', 'day', 'month'].includes(dt.unit as string)) {
      issues.push({
        path: 'defaultDispatchTime.unit',
        message: "must be 'hour', 'day', or 'month'",
      });
    }
  }

  /**
   * `environment` (#1377), when present, must be exactly `'sandbox'` or
   * `'production'` — the neutral Shop API environment choice the factory maps to
   * a base URL. Absent is valid (legacy connections used `baseUrl` directly, and
   * the factory falls back to the prod default).
   */
  private validateEnvironment(value: unknown, issues: FlatValidationIssue[]): void {
    if (value === undefined) {
      return;
    }
    if (typeof value !== 'string' || !(ErliEnvironmentValues as readonly string[]).includes(value)) {
      issues.push({
        path: 'environment',
        message: `must be one of: ${ErliEnvironmentValues.join(', ')}`,
      });
    }
  }

  /**
   * `allegroEnvironment`, when present, must be exactly `'sandbox'` or
   * `'production'` — the two hosts `AllegroCategoryCatalogClient` resolves
   * against. Absent is valid (defaults to `'production'` at read time).
   */
  private validateAllegroEnvironment(value: unknown, issues: FlatValidationIssue[]): void {
    if (value === undefined) {
      return;
    }
    if (
      typeof value !== 'string' ||
      !(AllegroCatalogEnvironmentValues as readonly string[]).includes(value)
    ) {
      issues.push({
        path: 'allegroEnvironment',
        message: `must be one of: ${AllegroCatalogEnvironmentValues.join(', ')}`,
      });
    }
  }

  /**
   * `allegroCategoryAccessEnabled`, when present, must be a boolean. This is
   * the non-secret, FE-visible signal that `allegroClientId`/`allegroClientSecret`
   * are both configured on this connection (#1383, ADR-031 "Correction") —
   * `connection.supportedCapabilities` cannot serve this purpose since it is a
   * static, per-adapterKey manifest value, not computed per connection instance.
   */
  private validateAllegroCategoryAccessEnabled(value: unknown, issues: FlatValidationIssue[]): void {
    if (value === undefined) {
      return;
    }
    if (typeof value !== 'boolean') {
      issues.push({
        path: 'allegroCategoryAccessEnabled',
        message: 'must be a boolean when provided',
      });
    }
  }

  /**
   * `masterCatalogConnectionId`, when present, must be a valid UUID v4 — the id
   * of the connection whose catalog offers/publishes source from (#1501).
   * Shape-only: an absent value is valid so order-ingestion-only connections are
   * not blocked (presence is a capability-gated follow-up, not enforced here).
   * Mirrors Allegro's `@IsOptional() @IsUUID('4')` posture.
   */
  private validateMasterCatalogConnectionId(value: unknown, issues: FlatValidationIssue[]): void {
    if (value === undefined) {
      return;
    }
    if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
      issues.push({
        path: 'masterCatalogConnectionId',
        message: 'must be a valid UUID',
      });
    }
  }
}
