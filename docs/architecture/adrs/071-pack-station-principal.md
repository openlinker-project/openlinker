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

## Amendment (#3653, 2026-10-05): the in-bench handover is retired; D13 is stated at sign-in

**What changed.** The bench's own two-step "Switch packer" handover (#2413) is removed. The bench now renders the application's topbar, and a packer leaves the way they leave any page: **Sign out** in the user menu, which clears the session and the query cache and goes to `/login`. The next packer signs in, and a packer's session is sent back to `/bench`. The idle lock (A3) is unchanged: it still clears the session in place and keeps the bench body mounted under the sign-in overlay.

**How D13 is satisfied without it.** D13 itself is unchanged: the last verifier owns the parcel. What the handover screen added was *telling* the incoming packer so before they took a box on. That statement now lives on the bench's sign-in overlay (`benchIdentityCopy.signIn.attribution`): *the next person to finish an open box is the one recorded as having packed it; check what has already been verified before you take it on.* That overlay is where a packer signs in whenever the bench locked under someone else. That is the idle-lock case, the one this ADR's Consequences name as the mis-attribution risk at an unattended shared terminal.

**What is given up, stated so it is not rediscovered as a regression.**

- **The explicit pause is gone.** The handover screen showed the incoming packer what had been verified *before* the outgoing session cleared. Nothing already verified is lost on the round trip, because each unit is recorded server-side as it is scanned (E1), so the parcel reopens with its verified lines. But no screen now makes the incoming packer stop and look before scanning.
- **The explicit sign-out path does not show the line.** `/login` is the application-wide sign-in page and stays bench-agnostic. An incoming packer reaches the D13 statement only when the bench locked first, not when the outgoing packer signed out deliberately.
- **Story A2 is satisfied by the round trip, not in place.** "Switching user is reachable from the packing surface without returning to the application shell" now holds only for the lock path. The user menu is on the bench's own topbar, but signing out leaves `/bench` for `/login`.

**Revisit when** inherited boxes are found closed under a packer who did not know they were taking them on, or terminal switching outgrows D16's "a few times a shift". Either brings back an in-bench switch, and the D13 statement must move with it.

## References

- #2080 (this decision), #2079 (the guard), #1032 § 6C/6D (the superseded design)
- `docs/specs/product-spec-oms-wave3b-scan-pick-pack.md` — D1, D2, D3, D12, D13, D15, D16
- [ADR-034](./034-mcp-authorization-user-issued-pats.md) — the `@Public()` + dedicated-verifier precedent
