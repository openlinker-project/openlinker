/**
 * Shoper Constants
 *
 * Identity of the Shoper plugin and the facts about Shoper's REST API that
 * more than one file needs. Kept in one place so the manifest, the tester and
 * the validators cannot drift apart.
 *
 * @module libs/integrations/shoper/src
 */

export const SHOPER_ADAPTER_KEY = 'shoper.restapi.v1';
export const SHOPER_PLATFORM_TYPE = 'shoper';

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
