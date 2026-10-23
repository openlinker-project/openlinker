/**
 * Shoper Constants
 *
 * Identity of the Shoper plugin and the facts about Shoper's REST API that
 * more than one file needs. Kept in one place so the manifest, the tester and
 * the validators cannot drift apart.
 *
 * @module libs/integrations/shoper/src
 */
import type { AdapterMetadata } from '@openlinker/core/integrations';

export const SHOPER_ADAPTER_KEY = 'shoper.restapi.v1';
export const SHOPER_PLATFORM_TYPE = 'shoper';

/**
 * Outbound pacing for a connection whose operator set no `config.rateLimit`.
 *
 * Measured on a live trial shop (2026-10-22/23), not guessed: Shoper's limit
 * is PER SHOP and shared by every token and every integration installed on it.
 * A sustained 10 req/s was answered in full (every response advertises
 * `x-shop-api-limit: 10`); at 15 req/s about 5 req/s came back `429`, an HTML
 * page with no `Retry-After` and none of the `x-shop-*` headers, so the
 * transport cannot learn the wait from the answer and pacing has to be ours.
 *
 * 240/min (4 req/s, spaced - the limiter has no burst) is deliberately well
 * under the measured 10 req/s: the budget is shared with whatever else the
 * merchant runs against the same shop (ERP, marketplace connectors), and a 429
 * we cause there is a failure in somebody else's integration. `maxConcurrent: 4`
 * keeps a slow request from stacking more than the spacing allows. The bound is
 * per CONNECTION, so two OpenLinker connections to one shop get 240 each.
 */
export const SHOPER_DEFAULT_RATE_LIMIT: NonNullable<AdapterMetadata['defaultRateLimit']> = {
  requestsPerMinute: 240,
  maxConcurrent: 4,
};

/** Short brand label used as the prefix of domain exceptions and operator-facing messages. */
export const SHOPER_BRAND = 'Shoper';

/** Every Shoper REST resource lives under this prefix on the shop's own host. */
export const SHOPER_API_PATH_PREFIX = '/webapi/rest';

/**
 * Cheap, always-available probe (SPIKE-3638): returns the shop settings dump.
 * Needs no area-specific scope beyond a valid token, so a failure here is about
 * the token or the host, not about a missing permission.
 */
export const SHOPER_CONNECTION_TEST_PATH = '/application-config';

/**
 * The "Obszar sklepu" permissions the integration must be granted in the
 * shop's admin panel ("Dodaj integrację"). Shoper enforces them server-side
 * (`403 insufficient_scope`, SPIKE-3638 C3), so a token missing one fails the
 * capability that needs it, not the connection test. Listed for the operator
 * (README); the capabilities that use each area land with their
 * own epics.
 */
export const SHOPER_REQUIRED_SCOPES = [
  'produkty',
  'warianty produktów',
  'stany dostępności',
  'kategorie',
  'stawki vat',
  'magazyny',
  'zamówienia',
  'przesyłki',
  'statusy zamówień',
  'klienci',
  'webhooki',
  'dostawy',
  'płatności',
] as const;
