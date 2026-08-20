/**
 * eparagony.pl Adapter Constants
 *
 * Wire-level constants shared by the HTTP client, the factory and the adapters:
 * hosts, the mandatory API-version marker, the OAuth scope set OL is actually
 * granted, the outbound User-Agent, and the neutral provider identity stamped on
 * every `RegisterTransactionResult`.
 *
 * @module libs/integrations/eparagony/src
 */

/**
 * Neutral provider identity written to `RegisterTransactionResult.providerType`
 * and persisted verbatim by core. Matches the manifest `platformType` so an
 * operator surface can correlate a record with its connection without a lookup
 * table.
 */
export const EPARAGONY_PROVIDER_TYPE = 'eparagony';

/** Registry adapter key (#575). */
export const EPARAGONY_ADAPTER_KEY = 'eparagony.documents.v3';

/** Short brand label used as the prefix on operator-facing validation errors. */
export const EPARAGONY_BRAND = 'eparagony.pl';

/**
 * Value of the mandatory `X-Api-Version` header. The vendor documents it as
 * required on every call; live probing found it is NOT enforced on GETs, but the
 * documented contract is what we send - a server that starts enforcing it must
 * not break us.
 */
export const EPARAGONY_API_VERSION = '3';

/**
 * Non-generic `User-Agent`. The vendor rejects generic library agents
 * (`curl/7.64.1`) at the firewall, so this must stay identifying.
 */
export const EPARAGONY_USER_AGENT =
  'OpenLinker/1.0 (+https://github.com/openlinker-project/openlinker)';

/**
 * OAuth scopes requested at token issuance.
 *
 * DELIBERATELY NOT REQUESTED: `document_get_jws` and `report_fiscal_get`. Both
 * are refused for OL's client, and the token endpoint fails the WHOLE request
 * when an ungranted scope is asked for - so requesting them would break every
 * call, not merely the two endpoints they unlock. `document_action_get` is also
 * omitted: the document-actions read has no neutral counterpart in
 * `FiscalizationPort`.
 *
 * `document_create` covers `POST /documents` and (together with `ecommerce`) the
 * document status read; `printer_get` covers the connection-test diagnostic.
 */
export const EPARAGONY_SCOPES = ['document_create', 'printer_get', 'ecommerce'] as const;

/** Space-separated scope string for the `client_credentials` form body. */
export const EPARAGONY_SCOPE_PARAM = EPARAGONY_SCOPES.join(' ');

/**
 * Hard ceiling on the wall-clock a single `registerTransaction` may consume.
 *
 * FISCAL SAFETY - core's `FiscalRegistrationService` holds an in-flight lease
 * that it documents as strictly exceeding the longest supported provider
 * round-trip (its `MAX_SUPPORTED_PROVIDER_TIMEOUT_MS`, 120 s). Overrunning that
 * would let an expired lease be re-claimed while this call is still in flight
 * and register one sale twice. The value is mirrored here rather than imported
 * because core exports it from a service module, not from its barrel; the
 * headroom is deliberate.
 */
export const EPARAGONY_REGISTER_DEADLINE_MS = 110_000;
