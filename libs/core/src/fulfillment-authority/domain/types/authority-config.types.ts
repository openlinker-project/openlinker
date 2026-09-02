/**
 * Authority Config Coercion (#2304, ADR-052)
 *
 * Authority assignment is **config, not a table, in v1** (DESIGN §3 adjudication
 * 3): an operator's claim lives in `Connection.config.<configKey>` jsonb — no
 * schema, no migration — and is read here through the same untrusted-value
 * coercion precedent as `parseIsPrimaryInvoicing` (#2047) and
 * `readStockSafetyBuffer` (#1844).
 *
 * **This coercer covers authority assignment only — flags and scopes.** It is
 * explicitly NOT the reader for routing RULES: per ADR-054's storage amendment
 * those live as `oms_routing_rules` rows owned by the OMS plugin, never in a
 * `Connection.config.routing` jsonb blob, and nothing here should be extended to
 * reach them.
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 */

import { AUTHORITY_KIND_DESCRIPTORS, type AuthorityKind } from './authority-kind.types';
import { type AuthorityScope, isAuthorityScope } from './authority-scope.types';

/**
 * What one connection's config claims about one authority.
 *
 * `scopes` empty while `enabled` is true means the connection claims the
 * authority with no scope narrowing; a caller reads that as a `global` claim
 * only if the authority's own resolution says so — this type reports what was
 * written, it does not interpret it.
 */
export interface AuthorityConfigClaim {
  readonly enabled: boolean;
  readonly isPrimary: boolean;
  readonly scopes: readonly AuthorityScope[];
}

/**
 * The claim a missing, malformed or unrecognised config resolves to.
 *
 * Defaulting to *unheld* is the load-bearing direction. A malformed config that
 * granted an authority would hand physical control to a party on the strength of
 * a typo; one that withholds it falls back to the authority's default holder,
 * which for every ADR-052 row is today's shipped behaviour. Same asymmetry
 * `parseIsPrimaryInvoicing` encodes: an unissued invoice is recoverable, two
 * issued ones are not.
 */
const UNHELD: AuthorityConfigClaim = Object.freeze({
  enabled: false,
  isPrimary: false,
  scopes: Object.freeze([]) as readonly AuthorityScope[],
});

/** `true` and the string `'true'` — how a hand-edited JSON config arrives from a text field. */
function parseFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read one authority's claim out of an untrusted `Connection.config`.
 *
 * Pure: no I/O, not async, and it never mutates its argument (the returned
 * `scopes` array is freshly built, so a caller cannot reach back into the config
 * object through it).
 *
 * Malformed entries are dropped **individually** — one bad scope in a list of
 * four does not discard the other three, since silently withholding an authority
 * an operator did configure correctly is its own failure. Anything unrecognised
 * at the top level yields the disabled default rather than a throw.
 *
 * **A6 (`refund-trigger`) is read but never honoured as a grant.** Refund
 * authority never leaves OpenLinker (ADR-056); the key exists so an operator's
 * claim is observable and reportable — an OMS *requests* a refund and OL executes
 * or refuses with a persisted reason. Nothing may treat a truthy `refundTrigger`
 * claim as delegation.
 */
export function parseAuthorityConfig(config: unknown, kind: AuthorityKind): AuthorityConfigClaim {
  if (!isRecord(config)) {
    return UNHELD;
  }

  const raw = config[AUTHORITY_KIND_DESCRIPTORS[kind].configKey];

  // A bare `true` / `'true'` is the zero-ceremony form: claimed, unscoped, not primary.
  if (parseFlag(raw)) {
    return { enabled: true, isPrimary: false, scopes: [] };
  }
  if (!isRecord(raw)) {
    return UNHELD;
  }

  const enabled = parseFlag(raw.enabled);
  if (!enabled) {
    return UNHELD;
  }

  const scopes = Array.isArray(raw.scopes) ? raw.scopes.filter(isAuthorityScope) : [];

  return {
    enabled: true,
    isPrimary: parseFlag(raw.isPrimary),
    scopes,
  };
}
