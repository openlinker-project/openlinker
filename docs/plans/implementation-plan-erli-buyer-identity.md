# Implementation Plan: Erli buyer identity resolution (identity mode + email normalization) — #995

**Date**: 2026-06-16
**Status**: Ready for Review
**Estimated Effort**: ~0.5 day (one normalizer adapter + unit tests + one `register(host)` line + one barrel/docs touch)

---

## 1. Task Summary

**Objective**: Make Erli buyers resolve consistently into OpenLinker customers — the *same* Erli buyer maps to the *same* internal customer across orders — by wiring Erli into the **existing** customer-identity-resolution flow.

**Context**: #994 already produces an `IncomingOrder` carrying the raw buyer (`customerExternalId`, `customerEmail`) from Erli; #993's `ErliOrderSourceAdapter` feeds it into `OrderIngestionService`. What is missing is the platform-specific email-normalizer **seam** for Erli. Same-buyer→same-customer is already guaranteed in `email_fallback` mode because the resolver maps the stable `buyer.id` **first**; the normalizer only governs the `emailHash` fallback path. Erli's real email shape is unconfirmed (#992), so #995 ships a **baseline-only** normalizer (trim + lowercase, **no `+suffix` strip**) — fail-safe by construction — plus its registration and spec, so the seam and a regression anchor exist and #992 tightening (adding a domain-gated strip mirroring Allegro) is a one-file edit.

**Classification**: **Integration** (plugin-only). No CORE change required — the per-platform email-normalizer seam already exists in core.

**#992-provisional**: The actual Erli email shape is UNCONFIRMED (the #992 sandbox spike is not done). Because under-normalization (baseline-only) is **safe and reconcilable** (creates duplicate customers at worst) while over-normalization (stripping `+suffix`) is **dangerous** (silently merges two distinct buyers — see §5 / Alternative 2), #995 ships the conservative baseline-only behavior. This is behaviorally equivalent to the registry's `DEFAULT_EMAIL_NORMALIZER`; the adapter + registration + spec still ship as the **seam + regression anchor**. Flagged `PROVISIONAL (#992)` in every artifact it ships.

---

## 2. Scope & Non-Goals

### In Scope
- A new `ErliEmailNormalizerAdapter` implementing `EmailNormalizerPort`, co-located in `libs/integrations/erli/src/infrastructure/adapters/`, that applies the shared trim+lowercase **baseline only** and **does NOT strip any `+suffix`** (fail-safe; see §5/Alternatives). Behaviorally equivalent to `DEFAULT_EMAIL_NORMALIZER`, shipped as the per-platform seam + regression anchor so #992 tightening is a one-file edit.
- One registration line in `erli-plugin.ts` `register(host)`: `host.emailNormalizerRegistry.register(ERLI_ADAPTER_KEY, new ErliEmailNormalizerAdapter())`.
- Unit tests over authored fixtures (plus-addressing **PRESERVED**, lowercase+trim applied, idempotent, empty → empty).
- Confirm (no code) that email-absent already degrades to `external_only` mapping in `OrderIngestionService.resolveCustomerId`.
- A short `register(host)` doc-comment + plugin spec assertion that the normalizer is registered.

### Out of Scope
- **No CORE change.** The `EmailNormalizerPort` / `EmailNormalizerRegistryService` / `HostServices.emailNormalizerRegistry` seam and the `OrderIngestionService` null-email branch already exist (see §4). Plugin-side registration is the entire surface.
- **No identity-mode code.** `OL_CUSTOMER_IDENTITY_MODE` (`external_only` | `email_fallback`) is read once, env-driven and global, in `CustomerIdentityResolverService`'s constructor — not per-plugin. #995 contributes the normalizer only.
- No migration (no schema change; emailHash storage already exists).
- No FE, no controller, no DTO, no new env var.
- No confirmation of the real Erli email shape (that is #992's job).

### Constraints
- Stacked on the Erli chain in worktree `995-erli-buyer-identity` (branch `995-erli-buyer-identity`), which already contains the #994 mapper and #993 OrderSource. Single PR, `Closes #995`.
- Must not introduce Erli/platform literals into `libs/core` or `libs/shared` (the #585/E5 lesson — the prior Allegro rule that leaked into `shared::normalizeEmail` was deliberately pulled into the plugin).
- `EmailNormalizerPort.normalize` must be idempotent: `normalize(normalize(x)) === normalize(x)`.

---

## 3. Architecture Mapping

**Target Layer**: **Integration** — `libs/integrations/erli/src/infrastructure/adapters/`.

**Capabilities Involved**:
- `EmailNormalizerPort` (`libs/core/src/integrations/domain/ports/email-normalizer.port.ts:17-23`) — the port the new adapter implements.
- Indirectly: the customer-identity resolution flow (`CustomerIdentityResolverPort`, `OrderSourcePort` → `OrderIngestionService`), which already invokes the normalizer registry.

**Existing Services Reused** (all already present — no edits):
- `EmailNormalizerRegistryService` — `register(adapterKey, normalizer)` / `resolve(adapterKey)` (`libs/core/src/integrations/infrastructure/adapters/email-normalizer-registry.service.ts:30-56`).
- `HostServices.emailNormalizerRegistry` (`libs/plugin-sdk/src/host-services.ts:96-97`).
- `CustomerIdentityResolverService` — resolves the per-platform normalizer by `connection.platformType`/`adapterKey` and invokes `normalizer.normalize(email)` before `hashEmail` (`libs/core/src/customers/application/services/customer-identity-resolver.service.ts:328-335`, invocation at `:173-174`; up-front resolution at `:102`).
- `OrderIngestionService.resolveCustomerId` — passes the buyer into the resolver when email is present, and **already** degrades to `external_only` identifier-mapping when email is absent (`libs/core/src/orders/application/services/order-ingestion.service.ts:337-359`).
- `normalizeEmail` shared baseline (trim+lowercase), `@openlinker/shared/config` (used by `AllegroEmailNormalizerAdapter:21,25` and `DEFAULT_EMAIL_NORMALIZER`).
- The Erli plugin `register(host)` seam (`libs/integrations/erli/src/erli-plugin.ts:69-104`).

**New Components Required**:
- `ErliEmailNormalizerAdapter` (`libs/integrations/erli/src/infrastructure/adapters/erli-email-normalizer.adapter.ts`).
- Its unit spec (`.../__tests__/erli-email-normalizer.adapter.spec.ts`).

**Core vs Integration Justification**: This is **Integration**. CORE already exposes the platform-agnostic seam (`EmailNormalizerPort` + registry on the `HostServices` bag) precisely so marketplaces register their own masked-email rule at boot without touching core (#585/E5; `allegro-email-normalizer.adapter.ts:11-15` documents that the rule was *moved out* of shared/core into the plugin). Putting any Erli email literal in core would re-introduce the exact coupling #585 removed. Therefore #995 needs **no core seam and no core change** — confirmed below.

**Reference**: [Architecture Overview — Plugin contract / HostServices](../architecture-overview.md#10-plugin-manager--integrations); [Engineering Standards — Ports vs Concrete Implementations](../engineering-standards.md#ports-vs-concrete-implementations).

---

## 4. External / Domain Research

### External System (Erli)
- **Email shape**: **UNCONFIRMED (#992).** ADR-025 documents reconciliation-first posture, static API-key auth, and Allegro-ID taxonomy reuse but says nothing about buyer email shape (no email/identity/relay/buyer-PII mention in `docs/architecture/adrs/025-erli-marketplace-adapter.md`). The #994 mapper marks the buyer raw-passthrough and PROVISIONAL (`erli-order.mapper.ts:16-21,28-30,72-85`).
- **Possible shape (unconfirmed)**: Erli reuses Allegro taxonomy and is a Polish marketplace → an Allegro-style masked relay (`fixedPart+transactionId@domain`) is *one* plausible buyer-email form, where a transaction suffix would rotate per order. **But this is unverified, and acting on it (stripping `+suffix`) is the dangerous direction** — see §5. Even if Erli does mask, `email_fallback` maps the stable `buyer.id` first, so same-buyer→same-customer already holds without any strip; the strip would only ever *merge across distinct buyers*. So #995 ships baseline-only and defers any strip to #992.
- **Email-absent**: Erli's buyer email is optional (`erli-order.types.ts:75` — `email?: string`; `ErliOrderBuyer` at `:72-98`). When absent, identity must fall back to external-buyer-id-only mapping.

### Internal Patterns (the exact seam — cited)
- **Port**: `EmailNormalizerPort { normalize(email: string): string }` — `libs/core/src/integrations/domain/ports/email-normalizer.port.ts:17-23`. Doc requires idempotency.
- **Registry**: `EmailNormalizerRegistryService.register(adapterKey, normalizer)` / `.resolve(adapterKey) → registered ?? DEFAULT_EMAIL_NORMALIZER` — `libs/core/src/integrations/infrastructure/adapters/email-normalizer-registry.service.ts:30-56`. DI token `EMAIL_NORMALIZER_REGISTRY_TOKEN` at `libs/core/src/integrations/integrations.tokens.ts:29`; bound in `libs/core/src/integrations/integrations.module.ts:86,128-130`.
- **HostServices handle**: `readonly emailNormalizerRegistry: EmailNormalizerRegistryService` — `libs/plugin-sdk/src/host-services.ts:96-97`. This is the registration signature plugins use.
- **Allegro reference implementation**: `AllegroEmailNormalizerAdapter implements EmailNormalizerPort` — `libs/integrations/allegro/src/infrastructure/adapters/allegro-email-normalizer.adapter.ts:23-36`. Logic: `normalizeEmail(email)` baseline → **if not `@allegromail.*` return baseline (the strip is domain-gated)** → if local part has no `+` return baseline → else `localPart.split('+')[0] + '@' + domain`. Allegro deliberately gates the strip on its known relay domain and has an explicit test that RFC 5233 sub-addressing must be **PRESERVED** for non-relay addresses — `allegro-email-normalizer.adapter.spec.ts:52-56`. #995's Erli normalizer does **not** know Erli's relay domain, so it cannot replicate the gate safely yet → it ships baseline-only (preserves plus-addressing everywhere) until #992.
- **Allegro registration**: `host.emailNormalizerRegistry.register('allegro.publicapi.v1', new AllegroEmailNormalizerAdapter())` inside `register(host)` — `libs/integrations/allegro/src/allegro-plugin.ts:111-114` (NestJS module threads `EMAIL_NORMALIZER_REGISTRY_TOKEN` into `HostServices` and calls `plugin.register?.(host)` — `allegro-integration.module.ts:111-114,214`). Erli is wired the same way via `createNestAdapterModule` (`erli-integration.module.ts`), so the host already supplies a populated `HostServices` bag with `emailNormalizerRegistry`.
- **Resolution + invocation in the flow**:
  - `CustomerIdentityResolverService.resolveEmailNormalizer(sourceConnectionId)` → `connectionPort.get` → `integrationsService.resolveAdapterMetadata({ platformType, adapterKey })` → `emailNormalizerRegistry.resolve(metadata.adapterKey)` — `customer-identity-resolver.service.ts:328-335`.
  - Resolved once up-front: `const normalizer = email ? await this.resolveEmailNormalizer(sourceConnectionId) : null;` — `:102`.
  - Invoked in email-fallback: `const normalizedEmail = normalizer.normalize(email); const emailHash = hashEmail(normalizedEmail);` — `:173-174`. **The buyer.id mapping is resolved BEFORE this**, so for a returning buyer the resolver never reaches the emailHash path — same-buyer→same-customer holds with baseline-only normalization.
  - **Single-match reuse (the merge risk)**: when exactly **one** existing customer matches the `emailHash`, the resolver **attaches the incoming buyer onto that existing internal customer** — `customer-identity-resolver.service.ts:201`. The collision policy (>1 match → new customer) does **NOT** guard this first 1-match case. So if a normalizer over-strips and produces a colliding hash for two *distinct* buyers (`user+shopA@…` and `user+shopB@…` → `user@…`), the second buyer is silently linked to the first buyer's customer = cross-buyer PII linkage. This is why the strip is the dangerous direction and #995 ships baseline-only.
  - **Identity mode** read once, env-driven, global in the constructor: `getEnv('OL_CUSTOMER_IDENTITY_MODE', DEFAULT_CUSTOMER_IDENTITY_MODE)` → `'email_fallback'` | `'external_only'` (legacy `true`/`false` aliases) — `:48-88` (mode types: `customer-identity.types.ts:16,31`). Confirmed **not per-plugin**.
  - **Collision policy** (>1 emailHash match → new customer, no merge, `collisionDetected:true`) — `:254-274`. Unchanged by #995.
- **Email-absent degradation (already handled, no code needed)**: `OrderIngestionService.resolveCustomerId` — if no `customerExternalId` → `undefined`; if `customerEmail` present → call `customerIdentityResolver.resolveCustomerIdentity`; **else (email absent) → `identifierMapping.getOrCreateInternalId(Customer, customerExternalId, connectionId, …)`** — i.e. external-only mapping by buyer id — `order-ingestion.service.ts:337-359` (resolver call at `:346`, external-only fallback at `:353-357`). This is exactly the `external_only` behavior the issue asks for, and it is already in place.
- **Buyer fields on the contract**: `IncomingOrder.customerExternalId?: string`, `customerEmail?: string` — `libs/core/src/orders/domain/types/incoming-order.types.ts:37-51`. The #994 mapper populates both: `customerExternalId: order.buyer.id`, `customerEmail: order.buyer.email` — `erli-order.mapper.ts:66-67`.
- **Adapter key**: `ERLI_ADAPTER_KEY = 'erli.shopapi.v1'` — `erli.constants.ts:10`. The registry is keyed by `adapterKey`, and `resolveAdapterMetadata` returns Erli's `adapterKey`, so registering under `ERLI_ADAPTER_KEY` is correct (same pattern as Allegro under `'allegro.publicapi.v1'`).

### Conclusion of research — the central design question
**Plugin-only. No core seam needed.** The per-platform `EmailNormalizerPort` registry already exists and is exposed on `HostServices`; the email-absent → `external_only` degradation already exists in `OrderIngestionService`. #995 is: implement one **baseline-only** Erli normalizer adapter + register it + unit tests. Same-buyer→same-customer is already guaranteed by the buyer.id mapping (resolved first); baseline-only is fail-safe (under-normalization only risks duplicate customer records, which are reconcilable, never cross-buyer merges). The adapter ships as the per-platform seam + regression anchor so #992 can tighten to a domain-gated strip (mirroring Allegro's `@allegromail.` gate) in a single file once the real shape is known. If `external_only` is active or email is absent, the existing core path already handles it.

---

## 5. Questions & Assumptions

### Open Questions
- **(#992-provisional) What is Erli's real buyer-email shape?** Masked relay (`fixedPart+transactionId@domain`)? Real deliverable email? Frequently absent? The sandbox spike (#992) resolves this. This plan does **not** guess — it ships baseline-only normalization (fail-safe) and defers any strip to #992.
- **(#992) If masked, what is the relay domain?** Allegro's marker is the `@allegromail.` domain check. Erli's marker domain is unknown. **Until it is known, no strip is performed** (a domain-gated strip mirroring Allegro is the #992 follow-up).

### Assumptions
- **A1 (key assumption — fail-safe default):** Erli's buyer-email shape is unconfirmed (#992), so #995 ships a **baseline-only** normalizer (trim + lowercase via the shared `normalizeEmail` baseline, **no `+suffix` strip**). This is the deliberate fail-safe choice: under-normalization only ever creates *duplicate, reconcilable* customer records, whereas over-normalization (stripping `+suffix`) silently **merges two distinct buyers** onto one internal customer via the resolver's single-match reuse path (`customer-identity-resolver.service.ts:201`) — the collision policy does NOT guard that first 1-match case = cross-buyer PII linkage. Same-buyer→same-customer already holds without any strip because `email_fallback` resolves the stable `buyer.id` mapping **first**. Behaviorally this equals `DEFAULT_EMAIL_NORMALIZER`; the adapter + registration + spec still ship as the seam + regression anchor.
- **A2 — no domain-gated strip yet:** Unlike Allegro (which gates its strip on the known `@allegromail.` relay domain and explicitly **preserves** RFC 5233 sub-addressing elsewhere — `allegro-email-normalizer.adapter.spec.ts:52-56`), #995 performs **no strip at all** because Erli's relay domain is unknown. Guessing a domain (or stripping `+` unconditionally) is the dangerous direction. #992 is the single reconciliation point: once the relay domain is confirmed, add a domain-gated strip mirroring Allegro in this one file. This is a deliberate, fail-safe divergence from the Allegro mirror, not an oversight.
- **A3:** `OL_CUSTOMER_IDENTITY_MODE` stays env/global; #995 adds no mode logic.
- **A4:** Email-absent already maps external-only via `OrderIngestionService` (`:353-357`) — no #995 code there. Verified, not assumed-blind.
- **A5:** No new env var; no migration; no new dependency.

### Documentation Gaps
- ADR-025 has no buyer-identity/email section. After #992 confirms the shape, add a one-paragraph "buyer identity & email normalization" note to ADR-025 (or a follow-up ADR if the behavior is non-obvious). Out of scope for #995's code; flagged here.

---

## 6. Proposed Implementation Plan

### Phase 1: Erli email normalizer adapter

**Goal**: Ship a `EmailNormalizerPort` implementation for Erli that applies the **baseline only** (no `+suffix` strip), as the fail-safe per-platform seam + regression anchor, with #992 as the single reconciliation point for tightening.

**Steps**:
1. **Create `ErliEmailNormalizerAdapter`**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/erli-email-normalizer.adapter.ts` (co-located with the other Erli adapters under `infrastructure/adapters/` — **not** a `mappers/` directory).
   - **Action**: New class `ErliEmailNormalizerAdapter implements EmailNormalizerPort` (port from `@openlinker/core/integrations`; baseline `normalizeEmail` from `@openlinker/shared/config`). The body delegates to the shared baseline and does **NOT** strip any `+suffix`:
     ```
     normalize(email): string {
       return normalizeEmail(email);   // trim + lowercase ONLY — no +suffix strip (fail-safe; see #992)
     }
     ```
   - File header (per Engineering Standards): purpose + the #585/E5 rationale (core stays platform-clean) + a **`PROVISIONAL (#992)`** block stating: the email shape is unconfirmed; the adapter is **deliberately baseline-only** because stripping `+suffix` is the dangerous direction — it would silently merge distinct buyers via the resolver's single-match reuse (`customer-identity-resolver.service.ts:201`), which the collision policy does not guard, whereas under-normalization only creates reconcilable duplicate customers; this is behaviorally equal to `DEFAULT_EMAIL_NORMALIZER` but ships as the seam + regression anchor so #992 tightening is a one-file edit; **#992 follow-up** = add a *domain-gated* strip mirroring Allegro's `@allegromail.` check (`allegro-email-normalizer.adapter.ts`) once Erli's relay domain is confirmed — never an unconditional strip.
   - **Acceptance**: Implements the port; idempotent; **pure (no DI, no I/O, no Logger)**; baseline-only so #992 reconciliation is a one-file edit.
   - **Dependencies**: none (port + baseline already exist).

2. **Unit test the adapter**
   - **File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-email-normalizer.adapter.spec.ts`
   - **Action**: Authored fixtures asserting the **baseline-only** contract (mirroring the *preservation* half of `allegro-email-normalizer.adapter.spec.ts:52-56`):
     - **plus-addressing PRESERVED**: `user+shop@gmail.com` → `user+shop@gmail.com` (unchanged except lowercase/trim) — the load-bearing fail-safe assertion. Comment: `// #992: baseline-only by design — stripping +suffix would risk cross-buyer merge (resolver single-match reuse). Tighten to a domain-gated strip when Erli relay domain is confirmed.`
     - lowercases + trims: `  BUYER+abc@Example.PL  ` → `buyer+abc@example.pl` (sub-address kept; only case/whitespace normalized).
     - plain (no `+`) → baseline: `  Plain@Example.com  ` → `plain@example.com`.
     - idempotent: `normalize(normalize(x)) === normalize(x)`.
     - empty input → `''`.
     - **never logs**: assert `normalize` performs no logging / has no Logger dependency (e.g. no console/Logger spy fires); fixtures are obviously-fake (no real or guessed Erli relay domain).
     - masked-domain handling is **deferred to #992** (no masked-strip fixture); email-absent → external_only is untouched (covered by `OrderIngestionService`, not this spec).
   - **Acceptance**: `pnpm --filter @openlinker/integrations-erli test` green; describe block `ErliEmailNormalizerAdapter`; names follow `should …`/Allegro-spec style.
   - **Dependencies**: Step 1.

### Phase 2: Register + verify wiring

**Goal**: Register the normalizer in the plugin and pin the registration in the plugin spec.

**Steps**:
3. **Register in `erli-plugin.ts` `register(host)`**
   - **File**: `libs/integrations/erli/src/erli-plugin.ts`
   - **Action**: Add `host.emailNormalizerRegistry.register(ERLI_ADAPTER_KEY, new ErliEmailNormalizerAdapter());` inside `register(host)` (alongside the existing connection-tester / validator / classifier registrations, `:69-104`). Import the new adapter. Extend the `register(host)` doc-comment with a one-line note that #995 adds the email normalizer (PROVISIONAL #992).
   - **Acceptance**: `register(host)` registers the normalizer under `ERLI_ADAPTER_KEY`; no other behavior changed; type-checks.
   - **Dependencies**: Step 1.

4. **Assert registration in the plugin spec**
   - **File**: `libs/integrations/erli/src/__tests__/erli-plugin.spec.ts`
   - **Action**: The spec's `makeRegisterHost()` stub does **not** currently expose `emailNormalizerRegistry` — add `emailNormalizerRegistry: { register: jest.fn() }` to that stub so the registration is assertable. Then extend the existing `register(host)` test to assert `emailNormalizerRegistry.register` was called with `(ERLI_ADAPTER_KEY, <ErliEmailNormalizerAdapter instance>)`. (Mirror however the spec already asserts the connection-tester/validator registrations.)
   - **Acceptance**: spec green; registration regression-guarded.
   - **Dependencies**: Step 3.

5. **(Verification, no code) Confirm email-absent → external_only**
   - **Action**: Re-read `order-ingestion.service.ts:337-359` to confirm the email-absent branch maps external-only (it does, `:353-357`). Add a short note in the PR description citing this; **no code**.
   - **Acceptance**: Documented confirmation that #995 needs no core change for the email-absent path.

### Phase 3: Docs touch (optional but recommended)

6. **Note the Erli normalizer in the architecture doc**
   - **File**: `docs/architecture-overview.md` (Email Normalization section / Erli context entries) or a one-line ADR-025 follow-up note.
   - **Action**: One sentence: Erli registers a **baseline-only** `ErliEmailNormalizerAdapter` at `erli.shopapi.v1` (the per-platform seam; no `+suffix` strip yet); PROVISIONAL #992 (a domain-gated strip mirroring Allegro is the single reconciliation point in the adapter once Erli's relay domain is confirmed).
   - **Acceptance**: doc mentions Erli alongside Allegro; no rule duplication.
   - **Dependencies**: Steps 1–3.

### Implementation Details

**New Components**:
- **Infrastructure**: `ErliEmailNormalizerAdapter` (`infrastructure/adapters/erli-email-normalizer.adapter.ts`) + spec.
- **Domain / Application / Interface**: none.

**Configuration Changes**: none (`OL_CUSTOMER_IDENTITY_MODE` already exists; no new var).

**Database Migrations**: none.

**Events**: none emitted/consumed by #995.

**Error Handling**: none — `normalize` is total and pure (returns baseline on empty/odd input, matching Allegro). No exceptions.

**Barrel**: The Erli normalizer is package-private (registered internally via `register(host)`); it is **not** added to `index.ts` (mirrors Allegro — the normalizer adapter is not exported from the Allegro barrel; only the plugin/manifest are public, `erli/src/index.ts`). No barrel edit.

**Reference**: [Engineering Standards — Project Structure / Naming Conventions](../engineering-standards.md#project-structure).

---

## 7. Alternatives Considered

### Alternative 1: Add a per-platform email-normalizer seam to CORE
- **Description**: Treat #995 as needing a core change (new port/registry).
- **Why Rejected**: The seam already exists end-to-end (`EmailNormalizerPort` + `EmailNormalizerRegistryService` + `HostServices.emailNormalizerRegistry` + the resolver invocation). Adding anything to core would duplicate it and re-introduce the platform coupling #585/E5 removed.
- **Trade-offs**: None — confirmed by direct citation, not assumption.

### Alternative 2: Strip `+suffix` unconditionally (no domain gate) — REJECTED as unsafe
- **Description**: After the baseline, strip a `+suffix` from the local part of **any** address that has one (no relay-domain gate), on the theory that Erli is probably an Allegro-style masked relay.
- **Why Rejected**: This **fails dangerous**. Two distinct buyers using RFC 5233 sub-addressing on the same mailbox (`user+shopA@gmail.com`, `user+shopB@gmail.com`) collapse to the same `user@gmail.com` hash. The resolver's **single-match reuse** path (`customer-identity-resolver.service.ts:201`) then attaches the second buyer onto the **first buyer's** internal customer — cross-buyer PII linkage — and the collision policy (>1 match → new customer) does **not** guard this first 1-match case. By contrast, baseline-only under-normalization only ever produces *duplicate, reconcilable* customer records. The asymmetry (silent merge vs. reconcilable dup) makes baseline-only the correct default. Allegro itself never does an unconditional strip — it gates on `@allegromail.` and has an explicit test that sub-addressing is **PRESERVED** elsewhere (`allegro-email-normalizer.adapter.spec.ts:52-56`). And in `email_fallback` the stable `buyer.id` is resolved first, so a returning buyer is already deduped without any strip.
- **Trade-offs**: If Erli *does* mask, baseline-only leaves per-order duplicate customers until #992 adds the domain-gated strip — a safe, reconcilable cost. This is the deliberate, documented fail-safe posture.

### Alternative 2b: Gate the strip on a guessed Erli relay domain now
- **Description**: Mirror Allegro 1:1 but with a guessed `@erli-relay-domain` gate.
- **Why Rejected (for now)**: The Erli relay domain is unknown until #992. A guessed gate either silently no-ops (looks wired, dedups nothing) or — if the guess collides with a real domain — re-introduces the merge risk above. The honest move is to ship no strip and let #992 supply the confirmed domain; tightening is then a one-file edit.
- **Trade-offs**: None worth taking before #992 confirms the domain.

### Alternative 3: Put the rule back in `shared::normalizeEmail`
- **Description**: Special-case Erli in the shared baseline.
- **Why Rejected**: Exactly the anti-pattern #585/E5 removed (`allegro-email-normalizer.adapter.ts:11-15`). Leaks platform semantics into the platform-agnostic package.
- **Trade-offs**: None worth taking.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Integration-only; CORE untouched; uses the published `EmailNormalizerPort` seam (Ports vs Concrete; CORE↔Integration boundary).
- ✅ No platform literals in `libs/core`/`libs/shared`.

### Naming Conventions
- ✅ `*-email-normalizer.adapter.ts` / `ErliEmailNormalizerAdapter` mirrors `allegro-email-normalizer.adapter.ts` / `AllegroEmailNormalizerAdapter`. Spec under `__tests__/` (package convention).

### Existing Patterns
- ✅ Registration via `register(host)` matches every other Erli side-registration (`erli-plugin.ts:69-104`) and Allegro's normalizer registration (`allegro-plugin.ts:111-114`).

### Risks
- **R1 — Wrong email-shape assumption (#992).** Erli's real email shape is unconfirmed. **Mitigation**: ship the fail-safe baseline-only normalizer — its only downside if Erli *does* mask is reconcilable duplicate customers (never a cross-buyer merge); a pinned test asserts plus-addressing is PRESERVED. #992 tightens to a domain-gated strip in one file. **Provisional and flagged everywhere.**
- **R2 — Mode confusion.** Operators expecting per-connection identity mode. **Mitigation**: none needed in code; mode is documented global/env. PR note clarifies #995 only adds the normalizer.

### Edge Cases
- Email absent → handled by `OrderIngestionService` (external-only), no #995 code (`:353-357`).
- `external_only` mode active → resolver never reaches the normalizer; Erli buyers dedup by external buyer id (unchanged).
- Empty / malformed email string → baseline returns `''` / trimmed; `normalize` returns it unchanged (test-pinned).

### Backward Compatibility
- ✅ Additive and behaviorally inert at runtime. Before #995, Erli resolved to `DEFAULT_EMAIL_NORMALIZER` (trim+lowercase) via `resolve()`'s fallback; #995's baseline-only adapter is behaviorally identical, so no email-hash dedup behavior changes for Erli or any other platform (keyed by `ERLI_ADAPTER_KEY`). The value #995 delivers is the **seam + regression anchor** that makes the #992 domain-gated tightening a one-file edit — not a runtime behavior change.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-email-normalizer.adapter.spec.ts` — **plus-addressing PRESERVED** (load-bearing), lowercase+trim, plain→baseline, idempotent, empty→empty, never-logs + obviously-fake fixtures; masked-domain handling deferred to #992 (Phase 1 Step 2).
- `libs/integrations/erli/src/__tests__/erli-plugin.spec.ts` — assert `emailNormalizerRegistry.register(ERLI_ADAPTER_KEY, <ErliEmailNormalizerAdapter>)` is called (Phase 2 Step 4).

### Integration Tests
- **None required for #995.** The end-to-end masked-email dedup is already covered for Allegro by `apps/worker/test/integration/allegro-masked-email-identity.int-spec.ts`; the core flow is platform-agnostic and exercised there. An Erli int-spec is deferred until #992 confirms real fixtures (would otherwise pin a provisional shape into a slow test). Flag as optional follow-up.

### Mocking Strategy
- Adapter unit tests: no mocks (pure function over authored strings).
- Plugin spec: mock `HostServices` (jest-mocked registries), assert the registration call — mirrors the existing plugin-spec assertions.

### Acceptance Criteria
- [ ] `ErliEmailNormalizerAdapter implements EmailNormalizerPort`, **baseline-only (no `+suffix` strip)**, pure + idempotent, with a `PROVISIONAL (#992)` header + single reconciliation point (domain-gated strip deferred to #992).
- [ ] Registered in `erli-plugin.ts` `register(host)` under `ERLI_ADAPTER_KEY`.
- [ ] Unit spec green (all fixture cases above), plugin spec asserts registration.
- [ ] No CORE / `libs/shared` change; no migration; no new env var.
- [ ] Email-absent → external_only confirmed in PR note (cite `order-ingestion.service.ts:353-357`).
- [ ] `pnpm --filter @openlinker/integrations-erli test`, `pnpm lint`, `pnpm type-check` pass.

**Reference**: [Testing Guide](../testing-guide.md); [Engineering Standards — Testing Standards](../engineering-standards.md#testing-standards).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (plugin implements a CORE port; CORE unchanged)
- [x] Respects CORE vs Integration boundaries (no platform literal in core/shared)
- [x] Uses existing patterns (no new abstraction — exact Allegro mirror behind the existing registry seam)
- [x] Idempotency considered (`normalize` idempotent; required by the port)
- [x] Event-driven patterns — N/A (no events)
- [x] Rate limits & retries — N/A (pure function)
- [x] Error handling comprehensive (total function; no throw)
- [x] Testing strategy complete (unit + plugin-spec; int deferred to #992)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation
- [Architecture Overview](../architecture-overview.md) — Email Normalization; Plugin Manager / Integrations (HostServices)
- [Engineering Standards](../engineering-standards.md)
- [ADR-025: Erli marketplace adapter](../architecture/adrs/025-erli-marketplace-adapter.md)
- Reference implementation: `libs/integrations/allegro/src/infrastructure/adapters/allegro-email-normalizer.adapter.ts`
