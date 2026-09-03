# ADR-071: The pack station has no principal of its own

- **Status**: Proposed
- **Date**: 2026-09-02
- **Authors**: @piotrswierzy

## Context

Line-grain packing — "3 of 5 packed", barcode-verified — needs someone recording each line. #2080 asked what principal drives that bench, and proposed a long-lived *device session* plus a *per-order actor* resolved by PIN or badge.

**Placing a station principal on `req.user` would be unsafe.** `RolesGuard` returns `true` for any route carrying no `@Roles()` (`roles.guard.ts:28`) — ~121 of ~280 route decorators at `0470542e0`, buyer PII among them (#2079).

**A safe pattern exists.** MCP is `@Public()` plus a dedicated verifier populating `req.auth`, which no guard reads, so such a token cannot reach an undecorated route.

**No credential exists to build on.** A PIN would be a fifth credential entity beside `RefreshToken`, `PasswordResetToken`, `EmailConfirmationToken` and `McpToken` (`User` is the principal, not a credential), bringing enrolment, rotation, lockout and a brute-force surface at a bench endpoint. Eight products researched (#2080) show **no documented** PIN fast-switch or idle timeout — an absence of evidence, two of those vendors having refused direct retrieval.

## Decision

**The pack station has no principal. Every packer has an ordinary account; the bench is a device label.**

1. **No station token, no PIN, no badge.**
2. **Attribution is a real user id** on `fulfillment_works`, as `packedByUserId` ⊕ `packedByService`, mirroring `CHK_fulfillment_holds_actor` — so "a 3PL packed this" and "a human packed it, unrecorded" are not the same value.
3. **Packers get a narrower `packer` role**, not `operator`.
4. **#2079 is a prerequisite**, executed as audit *and decorate*: a narrower role means nothing while an undecorated route admits any authenticated principal.

## Alternatives considered

**A device principal on the MCP pattern** — `@Public()`, a dedicated verifier, a `station_tokens` table copying `mcp_tokens`' discipline. **This is cheaper and safer than the chosen option, and the earlier revision of this ADR misrepresented it.** Because the station token would be the *authorization* principal and a person only an *attribution* identity, it needs no `packer` role and **does not need #2079 at all** — `req.auth` is unreachable from `RolesGuard`, so it fails closed by construction. One table and one middleware, against reviewing authorization on 57 controllers.

**Station token plus tap-your-name attribution** — no per-packer credential whatsoever. The token authorizes; the packer self-asserts who they are. Cheapest of all, and the fastest possible handover.

**Device session plus PIN actor** (#2080's original) — authenticated attribution without password friction, at the cost of the fifth credential entity above.

**Device-grain attribution only** — "station 3 packed it". Rejected outright: a station cannot answer a question about a box.

### Why this one anyway

Three reasons, in order of weight:

1. **#2079 is a live defect, and a device principal routes around it rather than fixing it.** ~110 authenticated routes are role-unrestricted today, buyer PII among them. That is worth fixing whether or not a bench exists. Choosing the option that *requires* the fix is choosing to do work that is independently correct.
2. **Authenticated attribution is defensible; self-asserted is not.** D1 sets the standard at dispute resolution. "The record says Anna, and Anna authenticated" survives a disagreement; "someone tapped Anna's name" does not.
3. **No new credential machinery**, with no precedent in the tree to copy.

## Consequences

- **The wave is coupled to a security fix.** #2079 must land first — a scheduling cost the alternatives would not have incurred, accepted deliberately.
- **The failure mode is mis-attribution**, not credential theft: a packer who does not sign out leaves the next person's work under their name. Mitigated by an idle lock and a permanently visible signed-in name — rails the field does not document having.
- **The XOR records who *closed* the parcel, not everyone who touched it.** With auto-close and roaming benches a parcel is genuinely multi-contributor; the single actor is the responsible party and the verification ledger holds the rest. A reader must not take the field as a complete account of who handled a box.
- **CSRF is not a constraint.** `CsrfGuard` is not an `APP_GUARD`; it is hand-applied to `/auth/refresh` and `/auth/logout` only. #2080's concern does not arise.

## Revisit when

- **Terminal switching exceeds a few times per shift.** Password friction then defeats attribution, and the PIN option returns.
- **#2079 is judged too large to precede this wave.** The device principal becomes the cheaper path, and this decision should be re-taken rather than worked around.

## References

- #2080 (this decision), #2079 (the guard), #1032 § 6C/6D (the superseded design)
- `docs/specs/product-spec-oms-wave3b-scan-pick-pack.md` — D1, D2, D3, D12, D13, D15, D16
- [ADR-034](./034-mcp-authorization-user-issued-pats.md) — the `@Public()` + dedicated-verifier precedent
