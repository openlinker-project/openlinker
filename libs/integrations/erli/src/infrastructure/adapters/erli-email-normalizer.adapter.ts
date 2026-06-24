/**
 * Erli Email Normalizer Adapter (#995)
 *
 * Implements `EmailNormalizerPort` for the Erli marketplace, registered against
 * `EmailNormalizerRegistryService` at boot so CORE and the platform-agnostic
 * `@openlinker/shared/config::normalizeEmail` baseline stay free of any Erli
 * literal (#585 / E5 — the same rule that pulled the Allegro `@allegromail.`
 * special-case out of shared and into the Allegro plugin).
 *
 * Verified by the #992 spike: Erli's order `user.email` is a plain deliverable
 * email string — NOT an Allegro-style masked relay (`fixedPart+txId@domain`) and
 * NOT carrying a `+tag`. Baseline-only normalization (trim + lowercase, no
 * `+suffix` strip) is therefore the confirmed-correct behaviour, not a stopgap.
 *
 * Erli also exposes NO buyer id (the order carries `user.email` only), so identity
 * resolution keys on the (normalized) email under `email_fallback` — there is no
 * stable external buyer-id mapping to resolve first (#995). That makes the
 * no-strip choice doubly important: stripping a `+suffix` would silently MERGE
 * two distinct buyers (`user+shopA@gmail.com` and `user+shopB@gmail.com` →
 * `user@gmail.com`) onto one internal customer via the resolver's single-match
 * reuse path (`customer-identity-resolver.service.ts:201`), and the collision
 * policy (>1 match → new customer) does NOT guard that first 1-match case — a
 * cross-buyer PII linkage no downstream rule reverses. Under-normalization only
 * ever produces duplicate, reconcilable records; the risks are asymmetric, so
 * baseline-only wins.
 *
 * Behaviorally this equals `DEFAULT_EMAIL_NORMALIZER`; it ships as the
 * per-platform seam + regression anchor. Should Erli ever introduce a masked
 * relay domain, the change is a one-file edit: a DOMAIN-GATED strip mirroring
 * Allegro's `@allegromail.` gate (`allegro-email-normalizer.adapter.ts`) — never
 * an unconditional strip.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link EmailNormalizerPort} for the port interface
 */
import type { EmailNormalizerPort } from '@openlinker/core/integrations';
import { normalizeEmail } from '@openlinker/shared/config';

export class ErliEmailNormalizerAdapter implements EmailNormalizerPort {
  normalize(email: string): string {
    return normalizeEmail(email); // trim + lowercase ONLY — no +suffix strip (fail-safe; #992)
  }
}
