/**
 * `@openlinker/oms` — identity constants
 *
 * The adapter key, platform type and brand the OL-OMS plugin registers under
 * (#2405, ADR-055). Kept in their own module — the `erli.constants.ts`
 * precedent — so the manifest, the host composition seam and any future
 * capability adapter all name one source rather than repeating literals.
 *
 * @module libs/oms/src
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */

/**
 * Registry adapter key. Versioned from the first commit: ADR-055 keeps this
 * package publishable-but-not-published until the end-of-Wave-3 contract
 * freeze, and a `.v1` suffix is what lets a `.v2` coexist rather than
 * replace it.
 */
export const OMS_ADAPTER_KEY = 'openlinker.oms.v1';

/**
 * The `Connection.platformType` an OL-OMS row carries.
 *
 * **Beware an adjacent, unrelated vocabulary.** `'openlinker'` is ALSO an
 * `AuthorityAnswerKind` discriminant (`fulfillment-authority`, ADR-056),
 * meaning "OpenLinker decides this" — see
 * `apps/web/src/features/fulfillment-authority/api/who-decides.types.ts`.
 * The two are different unions in different contexts and neither gates on the
 * other; a reader grepping the literal will hit both, and they must NOT be
 * unified.
 */
export const OMS_PLATFORM_TYPE = 'openlinker';

/**
 * Human-readable plugin identifier surfaced in `dispatchCapability`'s error
 * message (#573), so an unsupported-capability rejection names the product an
 * operator recognises rather than an adapter key.
 */
export const OMS_BRAND = 'OpenLinker OMS';
