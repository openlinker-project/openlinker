/**
 * Allegro Host Resolver
 *
 * Single source of truth for Allegro's two base hosts, keyed by environment:
 *
 *   - Web host   (`allegro.pl`)     — serves the `/auth/oauth/authorize` browser UI,
 *                                     the `/auth/oauth/token` grant endpoint, AND the
 *                                     public buyer-facing storefront links.
 *   - REST host  (`api.allegro.pl`) — serves `/me`, `/sale/*`, `/order/*`, and every
 *                                     other REST call.
 *
 * Before #892 this `(environment) => host` lookup was duplicated across the adapter
 * factory, the connection tester, the OAuth-completion adapter, and the token-refresh
 * service. That duplication is exactly how #889 shipped — one copy held the web host
 * where the REST host was correct. Both alignment constraints now live here, in one
 * place, instead of being maintained-by-convention across files.
 *
 * Pure module: no NestJS, no DI. The only public surface is the two resolver functions.
 *
 * @module libs/integrations/allegro/src/infrastructure/http
 */
import { Logger } from '@openlinker/shared/logging';

const logger = new Logger('AllegroHosts');

// Web/site host — OAuth authorize + token endpoints and public storefront links.
const SANDBOX_WEB_BASE_URL = 'https://allegro.pl.allegrosandbox.pl';
const PRODUCTION_WEB_BASE_URL = 'https://allegro.pl';

// REST API host — distinct `api.` subdomain. The unknown-environment default MUST
// match the web host's default below: if the two diverge on the fallback, a connection
// could authorize on one Allegro environment but resolve REST calls against another,
// surfacing as a confusing 401/403 that looks like a credentials bug.
const SANDBOX_REST_API_BASE_URL = 'https://api.allegro.pl.allegrosandbox.pl';
const PRODUCTION_REST_API_BASE_URL = 'https://api.allegro.pl';

/**
 * Resolve the Allegro web/site base URL for an environment.
 *
 * Used for `/auth/oauth/authorize`, `/auth/oauth/token`, and buyer-facing storefront
 * links. Accepts an un-narrowed `string` (call sites operate on unvalidated config
 * values) and defaults to sandbox on anything other than `'production'`.
 */
export function getAllegroWebBaseUrl(environment: string): string {
  switch (environment) {
    case 'sandbox':
      return SANDBOX_WEB_BASE_URL;
    case 'production':
      return PRODUCTION_WEB_BASE_URL;
    default:
      logger.warn(`Unknown environment: ${environment}, defaulting to sandbox`);
      return SANDBOX_WEB_BASE_URL;
  }
}

/**
 * Resolve the Allegro REST API base URL for an environment.
 *
 * Used for `/me` and every other REST call. Accepts an un-narrowed `string` and
 * defaults to sandbox on anything other than `'production'` — the default MUST stay
 * aligned with {@link getAllegroWebBaseUrl}'s default (see the constant comment above).
 */
export function getAllegroRestApiBaseUrl(environment: string): string {
  switch (environment) {
    case 'sandbox':
      return SANDBOX_REST_API_BASE_URL;
    case 'production':
      return PRODUCTION_REST_API_BASE_URL;
    default:
      logger.warn(`Unknown environment: ${environment}, defaulting to sandbox`);
      return SANDBOX_REST_API_BASE_URL;
  }
}
