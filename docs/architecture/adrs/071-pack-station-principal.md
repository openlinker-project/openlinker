# ADR-071: The pack station has no principal of its own

- **Status**: Proposed
- **Date**: 2026-09-02
- **Authors**: @piotrswierzy

## Context

Line-grain packing — "3 of 5 packed", barcode-verified — needs someone recording each line. #2080 asked what principal drives that bench and how it is authorized, and proposed a long-lived *device session* plus a *per-order actor* resolved by PIN or badge.

Three facts bound the answer.

**The obvious implementation is unsafe.** `RolesGuard.canActivate` returns `true` for any route carrying no `@Roles()` decorator (`roles.guard.ts:28`). Measured on `main` at `0470542e0`: ~280 route decorators, **~121 without `@Roles`**, ~110 authenticated (the figure drifts as routes land; it is the proportion that matters, not the integer) — including `customers.controller.ts`'s two GETs (buyer PII), all of `products`, and the `sales-documents` rules surface. A station principal placed on `req.user` would reach every one of them. #2079 tracks the guard; `write-guard-coverage.spec.ts` cannot catch it, inspecting non-GET handlers only on a hand-listed 23-controller set.

**The safe pattern exists.** MCP is `@Public()` plus a dedicated `OAuthTokenVerifier` populating `req.auth`, which no guard or controller reads — so an MCP token structurally cannot reach an undecorated route.

**No credential exists to build on.** There is no PIN, badge or secondary-factor concept anywhere in `libs/core/src/users`. A PIN would be a fifth credential entity beside `RefreshToken`, `PasswordResetToken`, `EmailConfirmationToken` and `McpToken` (`User` is the principal, not a credential), bringing enrolment, rotation, lockout and a brute-force surface at a bench endpoint.

Field research across eight shipped products (recorded on #2080) found **no documented PIN or badge fast-switch, and no documented idle timeout, in any of them** — an absence of evidence rather than evidence of absence, and two of those products' help centres refused direct retrieval. Only Apilo documents attributing the packer at all.

## Decision

**The pack station has no principal. Every packer has an ordinary account; the bench is a device label.**

1. **No station token, no PIN, no badge.** No new credential entity, no shared-device bearer token.
2. **Attribution is a real user id**, consistent with the `packedByUserId` order-grain packing already stamps. It rides on `fulfillment_works` as an **exclusive-or** — `packedByUserId` ⊕ `packedByService` — mirroring `CHK_fulfillment_holds_actor`, so "a 3PL packed this" and "a human packed it, unrecorded" are not the same value.
3. **Packers get a narrower `packer` role**, not `operator`.
4. **#2079 becomes a prerequisite, executed as audit _and decorate_.** A narrower role means nothing while an undecorated route admits any authenticated principal.

Bounded by the operation this serves: terminals are shared and roaming, but a person changes terminal only a few times a shift, so password sign-in is acceptable friction. At dozens of switches a day it would not be, and this decision would reopen.

## Alternatives considered

**A device principal on the MCP pattern** — `@Public()` plus a dedicated verifier, a `station_tokens` table copying `mcp_tokens`' discipline (opaque prefix, SHA-256 at rest, non-nullable `expiresAt`, revocation). **Genuinely safer**: `req.auth` is unreachable from `RolesGuard`, so it fails closed without #2079. Rejected because attribution still requires per-packer accounts — so we would pay for a credential lifecycle *and* still need the role work. Note MCP scopes must not be extended for this: `McpTokenService` hardcodes its prefix, its scope union throws on unknown values, and the `mcp:write ⊃ mcp:read` implication is denormalised into existing rows.

**Device session plus PIN actor** (#2080's original). Rejected for the fifth-credential cost above, and because no product researched documents doing it.

**Device-grain attribution only** — "station 3 packed it". Rejected: attribution serves dispute resolution, and a station cannot answer a question about a box.

## Consequences

- **The failure mode becomes mis-attribution**, not credential theft: a packer who does not sign out leaves the next person's work under their name. Mitigated by an idle lock, a permanently visible signed-in name, and switching reachable from the packing surface — rails the field does not have, adopted deliberately.
- **CSRF is not a constraint.** `CsrfGuard` is not an `APP_GUARD`; it is applied by hand to `/auth/refresh` and `/auth/logout` only. #2080's concern about a bearer station sitting outside the CSRF path does not arise, and no exclusion is needed.
- **We forfeit a protection the rejected option had.** An ordinary session inherits the whole app, which is exactly why #2079 moves from adjacent cleanup to prerequisite. That is the price of this decision, not a coincidence beside it.
- **A shared bench holds a `packer` session**, so the audit must confirm what a packer may reach — not merely that routes carry *some* role.

## References

- #2080 (this decision), #2079 (the guard), #1032 § 6C/6D (the superseded design)
- `docs/specs/product-spec-oms-wave3b-scan-pick-pack.md` — decisions D1, D2, D3, D12, D13, D15, D16
- [ADR-034](./034-mcp-authorization-user-issued-pats.md) — the `@Public()` + dedicated-verifier precedent
- `apps/api/src/mcp/auth/ol-mcp-token.verifier.ts`, `libs/core/src/fulfillment/infrastructure/persistence/entities/fulfillment-hold.orm-entity.ts`
