# Implementation Plan: Resolve the publication day before the exchange-rate cache read (#2777)

**Date**: 2026-09-01
**Status**: Draft
**Estimated Effort**: 0.5–1 day

---

## 1. Task Summary

**Objective**: Close a permanent cache-miss defect in `CurrencyRateService.getRateFor`. On roughly 2 days in 7 (a weekend or holiday order-placement candidate day), the pre-fetch read is keyed on the **candidate** day the caller asked for, while the write ends up keyed on the day the source **actually published for** (an earlier day, per `ExchangeRateProviderPort.fetchRate`'s own contract). The two keys never coincide for that candidate, so the cache read misses **forever** for every order carrying it, and each one pays a live provider call — up to ~16 sequential HTTP requests per order on a pivot pair, because `NbpExchangeRateAdapter` walks back up to `NBP_MAX_WALK_BACK_ATTEMPTS = 8` per leg.

**Context**: This is accepted, documented debt in `libs/core/src/currency/application/services/currency-rate.service.ts`'s file header. It affects **ordinary order ingestion**, not only the epic #2452 remediation/restatement path. The fix proposed by the issue: let the adapter — the only layer that owns a publication calendar — resolve the candidate to its likely publication day **before** the pre-fetch cache read, via one new **optional** port method.

**Classification**: CORE (domain port + application service) + Integration (fx adapters: NBP, ECB, Fake).

---

## 2. Scope & Non-Goals

### In Scope
- One new **optional** method on `ExchangeRateProviderPort`: `resolveLikelyPublicationDay?(candidate: string): string`.
- `CurrencyRateService.getRateFor` probes for the method (ADR-046 pattern — never trusts the type) and, when present, keys the pre-fetch `findByKey` read on the resolved day instead of the raw candidate.
- NBP adapter implementation: delegate to its existing private `resolveWorkingDayAtOrBefore`.
- ECB adapter implementation: a new, deliberately narrow **weekend-only** variant (no Polish-calendar dependency).
- Fake adapter: identity implementation (`(candidate) => candidate`), so test determinism for existing specs is unchanged unless a spec explicitly opts in.
- Updating the "accepted debt" language in `currency-rate.service.ts`'s file header and in ADR-040 § Consequences (the `walk-back-on-miss` bullet) to describe the closed gap rather than restate it as a live cost.
- Unit tests for the new probing logic in `CurrencyRateService`, and for each adapter's `resolveLikelyPublicationDay`.

### Out of Scope
- A persisted `exchange_rate_date_resolutions` table (the #2124 shape) — explicitly rejected by the issue as unnecessary machinery once the adapter can answer the question purely.
- Widening `findByKey` to "latest row with `rateDate <= candidate`" — explicitly rejected as unsafe (cannot distinguish "no publication that day" from "not fetched yet"; would silently invent a rate assignment the adapter never made).
- Any change to `ExchangeRateRepositoryPort`'s append-only contract, or to what gets **written** — this changes only which key is **read**.
- Widening the (nonexistent today) `is*`-style capability guard for this port — deliberately not added, per ADR-046's reasoning (would silently stop recognising an out-of-tree provider compiled against an older `libs/core`).
- Any change to `resolveRateDate` (the candidate-derivation step in `order-fx-stamp.service.ts`) — untouched; this issue starts one step later, at the cache read.

### Constraints
- Independent of #2775 / #2776 (no dependency either way — see the issue's own "Dependencies" section).
- Per the issue's "Assumption to verify before sizing": the same-currency path (`from === to`) never reaches `getRateFor` at all (`order-fx-stamp.service.ts` step 3 short-circuits before any I/O), so this fix's payoff is proportional to the fraction of orders whose native currency differs from the reporting currency. Not re-verified with a live DB count in this plan (that count needs a running deployment); noted as an open question below rather than blocking the plan.
- Branch from `epic/2452-analytics-currency-coverage`, not `main` (per the issue's own "Branching / merge strategy" section — this issue is unhooked from the epic's merge gate but still branches from and PRs into the epic branch).

---

## 3. Architecture Mapping

**Target Layer**:
- Domain (port): `libs/core/src/currency/domain/ports/exchange-rate-provider.port.ts`
- Application (resolution): `libs/core/src/currency/application/services/currency-rate.service.ts`
- Infrastructure (adapters): `libs/integrations/fx/src/infrastructure/adapters/{nbp,ecb,fake}-exchange-rate.adapter.ts`

**Capabilities Involved**: `ExchangeRateProviderPort` — not a capability port (no manifest entry, no `getCapabilityAdapter` path; see the port file's own header), so this is a plain optional-interface-method addition, not a new `Capability` value.

**Existing Services Reused**:
- `ExchangeRateProviderRegistryPort.get(source)` — unchanged, still resolves the provider by source key.
- `ExchangeRateRepositoryPort.findByKey` / `.insertIfAbsent` — unchanged signatures; only the **argument** the service passes to `findByKey` changes.
- NBP's existing private `resolveWorkingDayAtOrBefore` (`nbp-exchange-rate.adapter.ts:456`) — reused verbatim as the method body, per the issue's explicit instruction ("No new calendar logic").

**New Components Required**:
- One new optional method signature on `ExchangeRateProviderPort`.
- One new private method `resolveWeekendAtOrBefore` (or similarly named) on `EcbExchangeRateAdapter` — a small, dependency-free weekend-only calendar function.
- One probe helper in `currency-rate.service.ts` (or inline in `getRateFor`, given it has exactly one call site — see § 7 Alternatives Considered).

**Core vs Integration Justification**: The port method signature and the probing call site belong in CORE (`currency` context) because `CurrencyRateService` is the one place both adapters are dispatched through, and the probe-not-trust discipline is a CORE-owned rule (ADR-046) applied uniformly regardless of which adapter answers. The calendar logic itself stays in Integration — NBP's Polish working-day calendar and ECB's weekend-only rule are source-specific facts core must not know (this mirrors `resolveRateDate`'s existing "deliberately calendar-neutral" design, cited directly by the issue).

---

## 4. External / Domain Research

### Internal Patterns

**ADR-046 optional-capability-probe precedent** (the exact pattern the issue asks to follow), already shipped twice in the repo:
```typescript
// libs/core/src/listings/application/services/description-format-resolution.ts:43
function declares(adapter: OfferFieldUpdater): adapter is OfferFieldUpdater & DescriptionFormatDeclaring {
  return typeof (adapter as Partial<DescriptionFormatDeclaring>).getDescriptionFormat === 'function';
}
```
and the `#2229` streaming-concurrency-ceiling precedent (`ResolveConcurrencyCeiling` § in architecture-overview.md, "Callers probe for the method rather than trusting `isEanCategoryMatcherStreaming`"). Both exist because widening a type guard would silently stop recognising an older out-of-tree plugin. This issue's new method follows the same shape: optional on the interface, probed with `typeof provider.resolveLikelyPublicationDay === 'function'` at the one call site, never added to any closed guard union (there is none for this port today, and none is being created).

**NBP's existing calendar primitive** (`nbp-exchange-rate.adapter.ts:452-459`):
```typescript
private resolveWorkingDayAtOrBefore(isoDay: string): string {
  const instant = isoDayToInstant(isoDay);
  return isPlWorkingDay(instant) ? isoDay : instantToIsoDay(previousWorkingDay(instant));
}
```
This is **exactly** the contract the new port method needs ("a day `<= candidate` such that no day in `(returned, candidate]` is a publication day") — no new logic, just a new public entry point calling the existing private one.

**ECB's stated reason it must NOT reuse the Polish calendar** (already documented in architecture-overview.md § Currency): "ECB publishes on Polish-only holidays, so a Polish calendar skips Corpus Christi 2026-06-04 and resolves 4.2383 where ECB's actual last publication before Friday 2026-06-05 is 4.2368." This is the concrete, already-verified divergence the issue's acceptance criteria ask to cite in a comment.

**`isoDayToInstant` / `instantToIsoDay`** — private helpers at the bottom of `nbp-exchange-rate.adapter.ts` (midday-UTC anchoring, to avoid a UTC+1/UTC+2 day-boundary shift). ECB's new method needs the identical anchoring discipline for its own `Date`-based weekend check, so it either imports the same pair from `@openlinker/shared/date` (if exported) or reimplements the identical midday-UTC anchor locally — see Phase 1 Step 2 for the exact choice.

### Documentation Gaps
- `@openlinker/shared/date` (`pl-working-days.ts`) exports no generic "is this ISO day a Saturday/Sunday" helper — only Polish-calendar-aware functions (`isPlWorkingDay`, `previousWorkingDay`, `isPlPublicHoliday`). The ECB adapter therefore cannot reuse anything from that module without accidentally pulling in Polish-holiday awareness, which the issue explicitly forbids. This is confirmed by reading `libs/shared/src/date/pl-working-days.ts` in full — noted as an assumption resolved in Phase 1 Step 2 below (write a tiny, adapter-local, dependency-free weekend check).

---

## 5. Questions & Assumptions

### Open Questions
- The issue's own "Assumption to verify before sizing" (a one-off `order_records` count grouped by `currency` vs the current reporting currency) has not been run against a live deployment as part of this plan — it needs a running Postgres instance with real data, which this planning pass does not have. **Assumption**: proceed with implementation regardless, since the fix is cheap (no migration, ~3 small files) relative to the two sibling remediation issues (#2775/#2776) it is independent of; if the count later shows the same-currency path dominates, this issue's priority (not its correctness) would be revisited.
- Whether `isoDayToInstant`/`instantToIsoDay` should be extracted to a shared, source-agnostic helper (used by both NBP and the new ECB method) or duplicated. **Assumption (see Phase 1 Step 2)**: duplicate a minimal local version in the ECB adapter file rather than extracting — extraction would touch NBP's file for a cosmetic reason unrelated to this issue's scope, and the two adapters are already independent packages-worth of calendar logic by design (per the ADR-040 "why both live in one package" note, they are *adjacent*, not *shared*).

### Assumptions
- The optional method is a **pure, synchronous, no-I/O** function per the issue's exact signature comment — confirmed compatible with both adapters' existing calendar helpers (`isPlWorkingDay`/`previousWorkingDay` are pure; a weekend check is trivially pure).
- No DTO, no HTTP surface, no migration — this is an internal core/adapter contract change only, invisible to `apps/api`/`apps/worker` callers beyond `CurrencyRateService` itself.
- The `Fake` adapter's identity implementation is the correct default — per the issue's explicit "Fake: identity, so test determinism is unchanged" instruction.

### Documentation Gaps
- ADR-040 § Consequences currently states the calendar-divergence fact (the "walk-back-on-miss" bullet, line ~218) but does not itself describe the permanent-cache-miss cost as "accepted debt" — that language lives only in `currency-rate.service.ts`'s file header. The issue's acceptance criterion ("ADR-040 § Consequences is updated to match") is interpreted as: append one sentence to that existing bullet, or a short adjacent one, recording that the candidate-to-published-date mismatch is now resolved for both shipped providers via the optional port method — not a full new ADR amendment section (this is a resolution of an existing cost, not a new architectural decision requiring its own numbered ADR per `docs/architecture/adrs/README.md § When to write an ADR`).

---

## 6. Proposed Implementation Plan

### Phase 1: Port + adapters
**Goal**: Every provider can (optionally) answer "what day would I actually publish for, on or before this candidate" with zero I/O.

**Steps**:

1. **Declare the optional port method**
   - **File**: `libs/core/src/currency/domain/ports/exchange-rate-provider.port.ts`
   - **Action**: Add, after `fetchRate`:
     ```typescript
     /**
      * A day <= `candidate` such that no day in `(returned, candidate]` is a
      * publication day for this source. Pure, synchronous, no I/O.
      *
      * Optional (ADR-046 probe-not-trust pattern — see
      * `description-format-resolution.ts` for the precedent): an adapter that
      * declares nothing keeps the pre-#2777 behaviour, where the cache read is
      * keyed on the candidate itself.
      *
      * A WRONG answer can only ever cause a cache *miss*, which falls through
      * to the existing `fetchRate` path unchanged — it can never produce a
      * wrong stamp. A HIT is provably the right row: a row exists under day
      * `X` only because the source supplied `effectiveDate = X`, and this
      * contract guarantees no publication day lies between `X` and the
      * candidate, so the hit equals what `fetchRate` would have returned.
      */
     resolveLikelyPublicationDay?(candidate: string): string;
     ```
   - **Acceptance**: `pnpm --filter @openlinker/core type-check` passes; no existing implementer of `ExchangeRateProviderPort` is forced to add the method (it is optional).
   - **Dependencies**: None.

2. **NBP: expose the existing private calendar method**
   - **File**: `libs/integrations/fx/src/infrastructure/adapters/nbp-exchange-rate.adapter.ts`
   - **Action**: Add a public method that delegates to the existing private one — no new calendar logic, per the issue's explicit instruction:
     ```typescript
     /**
      * Implements `ExchangeRateProviderPort.resolveLikelyPublicationDay`
      * (#2777). Delegates to the same working-day-calendar primitive
      * `fetchQuotesForNearestPublishedDay` already uses for the HTTP
      * walk-back — no second copy of the Polish working-day calendar.
      */
     resolveLikelyPublicationDay(candidate: string): string {
       return this.resolveWorkingDayAtOrBefore(candidate);
     }
     ```
     Place it near `fetchRate`, above the private `resolveWorkingDayAtOrBefore` it calls (no reordering of the existing private method needed — TS class methods can reference each other in any declaration order).
   - **Acceptance**: A spec proves `resolveLikelyPublicationDay('2026-08-15')` (a Saturday) returns `'2026-08-14'` (Friday), and `resolveLikelyPublicationDay('2026-08-13')` (an ordinary Thursday) returns itself.
   - **Dependencies**: Step 1.

3. **ECB: a weekend-only variant, explicitly NOT the Polish calendar**
   - **File**: `libs/integrations/fx/src/infrastructure/adapters/ecb-exchange-rate.adapter.ts`
   - **Action**: Add a small, dependency-free weekend check and the port method:
     ```typescript
     /**
      * Implements `ExchangeRateProviderPort.resolveLikelyPublicationDay`
      * (#2777). WEEKEND-ONLY, and that is deliberate: ECB publishes on
      * Polish-only holidays (verified divergence — Corpus Christi
      * 2026-06-04: a Polish-calendar walk-back skips it and resolves a
      * stale 4.2383 where ECB's actual last publication before Friday
      * 2026-06-05 is 4.2368, per this adapter's own header note and
      * ADR-040 § Currency). Reusing `isPlWorkingDay` here would therefore
      * silently reintroduce that exact bug. Only Sat/Sun are safe to skip
      * without source-specific holiday knowledge this adapter must not
      * have — a Polish-only holiday that also happens to be a genuine ECB
      * non-publication day still falls through to the existing
      * `lastNObservations=1` walk-back inside `fetchRate` (§ header "NO
      * WALK-BACK LOOP, AND THAT IS THE POINT"), so a wrong guess here
      * degrades to a normal live fetch, never a wrong stamp.
      */
     resolveLikelyPublicationDay(candidate: string): string {
       // Midday UTC, matching the file's existing anchoring discipline —
       // anchoring at midnight would put a UTC+1/UTC+2 shift on the wrong
       // side of the day boundary.
       const instant = new Date(`${candidate}T12:00:00Z`);
       const day = instant.getUTCDay(); // 0 = Sunday, 6 = Saturday
       if (day === 0) {
         return addUtcDays(candidate, -2); // Sunday -> Friday
       }
       if (day === 6) {
         return addUtcDays(candidate, -1); // Saturday -> Friday
       }
       return candidate;
     }
     ```
     plus a tiny local helper:
     ```typescript
     function addUtcDays(isoDay: string, delta: number): string {
       const instant = new Date(`${isoDay}T12:00:00Z`);
       instant.setUTCDate(instant.getUTCDate() + delta);
       return instant.toISOString().slice(0, 10);
     }
     ```
   - **Acceptance**: A spec proves `resolveLikelyPublicationDay('2026-08-15')` (Saturday) returns `'2026-08-14'` (Friday); `resolveLikelyPublicationDay('2026-06-04')` (Corpus Christi, a Thursday — a genuine Polish holiday) returns **itself**, `'2026-06-04'`, proving the method does NOT consult the Polish calendar; an ordinary weekday returns itself.
   - **Dependencies**: Step 1.

4. **Fake: identity**
   - **File**: `libs/integrations/fx/src/infrastructure/adapters/fake-exchange-rate.adapter.ts`
   - **Action**: Add:
     ```typescript
     /** Identity — test determinism for existing specs is unaffected (#2777). */
     resolveLikelyPublicationDay(candidate: string): string {
       return candidate;
     }
     ```
   - **Acceptance**: Every existing `FakeExchangeRateAdapter`-based spec continues to pass unmodified.
   - **Dependencies**: Step 1.

### Phase 2: Wire the probe into `CurrencyRateService`
**Goal**: The pre-fetch cache read is keyed on the resolved day when a provider can answer; behaviour is byte-identical when it can't.

**Steps**:

5. **Probe-and-resolve before `findByKey`**
   - **File**: `libs/core/src/currency/application/services/currency-rate.service.ts`
   - **Action**: Inside `getRateFor`, after the `provider.supports(...)` check and before `this.repository.findByKey(input)`, insert:
     ```typescript
     // ADR-046 probe-not-trust pattern (see description-format-resolution.ts):
     // an out-of-tree provider compiled against an older `libs/core` would
     // satisfy a widened type guard without implementing the method, so this
     // checks for the method itself rather than trusting the type.
     const likelyPublicationDay =
       typeof provider.resolveLikelyPublicationDay === 'function'
         ? provider.resolveLikelyPublicationDay(input.rateDate)
         : input.rateDate;

     const existing = await this.repository.findByKey({ ...input, rateDate: likelyPublicationDay });
     if (existing) {
       return existing;
     }
     ```
     Remove the old `const existing = await this.repository.findByKey(input);` line it replaces. The rest of the method (`fetchRate`, the `insertIfAbsent`/`DuplicateExchangeRateError` recovery path) is **unchanged** — a wrong resolution still falls through to `fetchRate` exactly as it does today when there is no cached row at all.
   - **Acceptance**:
     - A spec proves: for a Saturday candidate, `findByKey` is called with the Friday date, and when that row exists, **zero** `fetchRate` calls happen.
     - A spec proves: a provider declaring nothing (e.g. a bare mock without the method) behaves exactly as today — `findByKey` is called with the raw candidate.
     - A spec proves: a provider whose `resolveLikelyPublicationDay` returns a day with no cached row falls through to a normal `fetchRate` call, never producing a wrong or stale stamp.
   - **Dependencies**: Phase 1 (any provider mock used in the new specs may implement the method or not).

### Phase 3: Documentation
**Goal**: The two places that currently describe this as *accepted, permanent* debt are updated to describe it as resolved.

**Steps**:

6. **Update the file header**
   - **File**: `libs/core/src/currency/application/services/currency-rate.service.ts`
   - **Action**: Rewrite the header's "WHAT THE REGISTRY DOES AND DOES NOT ABSORB" section. Keep the explanation of *why* the two keys can differ (candidate vs. published day) — that fact doesn't change — but replace "the pre-fetch read goes on missing... EVERY order carrying that candidate makes a live provider call" with a note that `resolveLikelyPublicationDay` (#2777) now lets an adapter that knows its own calendar close this gap for its own pairs, and that a provider declaring nothing keeps the old candidate-keyed behaviour. Remove the "Memoising the candidate-to-published-date mapping needs its own persisted table... (#2124)" sentence, since the adapter-declared method is now the shipped mechanism.
   - **Acceptance**: The header no longer states or implies the miss is unconditionally permanent.
   - **Dependencies**: Phase 1 + 2 (the fix must exist before the header can describe it as fixed).

7. **Update ADR-040 § Consequences**
   - **File**: `docs/architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md`
   - **Action**: Append one sentence to the existing "The two providers publish on different calendars..." bullet (§ Consequences, ~line 218), noting that as of #2777 each adapter also declares an optional `resolveLikelyPublicationDay` so the pre-fetch cache read can key on the day it will actually publish for, closing a previously-permanent cache-miss cost for weekend/holiday candidates.
   - **Acceptance**: The bullet reads as historically accurate and forward-looking, without inventing a new numbered amendment section (this is closing a documented cost, not making a new architectural decision — see `docs/architecture/adrs/README.md § When to write an ADR`).
   - **Dependencies**: Phase 1 + 2.

---

## 7. Alternatives Considered

### Alternative 1: Widen `findByKey` to "latest row with `rateDate <= candidate`"
**Description**: Change the repository read to accept any row on or before the candidate day, regardless of whether it's the freshest.
**Why Rejected**: Explicitly rejected in the issue. Cannot distinguish "no publication that day" from "not fetched yet"; has no bound (a 9-day-stale row for an unrelated older order would silently answer a brand-new candidate); would invent a rate assignment the adapter never made, on the one figure whose entire purpose is auditability (ADR-040).
**Trade-offs**: Would need no adapter changes at all, but trades correctness for simplicity in exactly the wrong place.

### Alternative 2: A persisted `exchange_rate_date_resolutions (source, candidate_date) -> published_date` table (#2124 shape)
**Description**: Memoize the candidate-to-published mapping in its own table, populated lazily on each miss.
**Why Rejected**: Strictly more machinery (migration, table, repository, a second cache to reason about) for the same idea the adapter-declared method achieves for free, since the calendar is already known statically by the adapter. The issue reserves this as a fallback "if a source appears whose calendar cannot be computed purely."
**Trade-offs**: Would also close cross-order-batch cache warming faster on the very first order of a run (this issue's method recomputes the same pure calendar walk on every call, which is cheap and unmeasured but non-zero); rejected as premature optimization given neither provider's calendar function does any I/O.

### Alternative 3: An in-memory memo for the duration of one restatement page
**Description**: Cache the candidate→published mapping only within one remediation batch.
**Why Rejected**: Explicitly rejected in the issue — only helps the epic #2452 remediation path, dies with the process, and leaves ordinary ingestion (this issue's actual target) broken.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE ↔ Integration boundary change — the port stays in `libs/core/src/currency/domain/ports/`, both implementations stay in `libs/integrations/fx/`.
- ✅ No new cross-context edge — `currency` remains a leaf context (per architecture-overview.md § Currency: "nothing under it imports a sibling `@openlinker/core/*` context").
- ✅ Follows the existing ADR-046 probe-not-trust pattern verbatim rather than inventing a new one.

### Naming Conventions
- ✅ Method name `resolveLikelyPublicationDay` matches the issue's exact proposed signature and the existing `resolveWorkingDayAtOrBefore` / `resolveRateDate` naming family (`resolve*` for a pure day-derivation function).
- ✅ No new file needed — additions are to existing port/adapter/service files, consistent with how `getDescriptionFormat` was added to an existing capability interface rather than a new one.

### Existing Patterns
- ✅ Reuses NBP's existing private calendar method exactly, per the issue's explicit "No new calendar logic" instruction.
- ✅ ECB's variant deliberately does NOT reuse `@openlinker/shared/date`'s Polish-calendar helpers — consistent with the adjacent `resolveRateDate` design principle ("deliberately calendar-neutral... a shared Polish calendar in core would be wrong").

### Risks
- **A subtly wrong `resolveLikelyPublicationDay` implementation could theoretically cause a false cache HIT.** Mitigated structurally: the contract requires "no publication day in `(returned, candidate]`", and the two shipped implementations (NBP's exact existing calendar function; ECB's conservative weekend-only rule) are both already correctness-verified by existing/new specs. A wrong answer that OVER-walks-back (returns a day further back than necessary) still cannot cause a wrong stamp — it would only ever find an existing row that is itself correctly keyed (the row was written under the day the source actually published for), so worst case is a slightly-stale-but-still-genuinely-published rate being reused one extra day past when a fresher one exists — which is exactly what the ordinary `existing` cache-hit path already does for a ordinary same-day-publication candidate seen twice.
- **ECB's weekend-only rule under-covers relative to NBP's full calendar.** This is intentional per the issue (a Polish-only holiday must NOT be treated as an ECB non-publication day) — the residual cost (Polish-holiday-but-not-weekend candidates against ECB still cost a live `fetchRate` call, which itself has no walk-back and resolves in one HTTP round-trip) is smaller than today's status quo and is explicitly accepted rather than an oversight.

### Edge Cases
- **Candidate is itself a publication day** (~5/7 of the time): both NBP's and ECB's methods return the candidate unchanged — behaviour identical to today's cache-hit path.
- **A provider declares the method but throws inside it**: not currently guarded. **Recommendation to confirm during implementation**: since both shipped implementations are pure arithmetic with no failure mode (no I/O, no external state), an unguarded call is acceptable — mirrors the unguarded `getDescriptionFormat()` call pattern in `description-format-resolution.ts`, which also does not wrap the probe in try/catch. Flagged here for reviewer awareness rather than pre-emptively adding defensive code the precedent doesn't use.
- **The resolved day differs from the candidate but there is still no cached row** (a genuinely uncached weekend/holiday date): falls through to the normal `fetchRate` → `insertIfAbsent` path unchanged; the `DuplicateExchangeRateError` recovery branch (a concurrent caller or a walk-back landing on an already-written day) is unaffected by this change since it operates on `fetched.rateDate` (the adapter's own answer), not on `likelyPublicationDay`.

### Backward Compatibility
- ✅ Fully backward compatible. The method is optional; a provider (in-tree or an out-of-tree plugin) declaring nothing gets byte-identical behaviour to before this change (probe short-circuits to `input.rateDate`, exactly the previous unconditional value).
- ✅ No schema, no migration, no DTO change, no HTTP contract change.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

**File**: `libs/core/src/currency/application/services/__tests__/currency-rate.service.spec.ts`
- `should key the pre-fetch read on the resolved publication day when the provider declares resolveLikelyPublicationDay` — mock provider's `resolveLikelyPublicationDay` returns a Friday for a Saturday candidate; assert `repository.findByKey` was called with the Friday date and `provider.fetchRate` was never called (row exists under Friday).
- `should key the pre-fetch read on the raw candidate when the provider declares nothing` — mock provider has no `resolveLikelyPublicationDay` property at all; assert `repository.findByKey` was called with the original candidate — proves the pre-#2777 behaviour is preserved byte-for-byte.
- `should fall through to fetchRate when the resolved day still misses the cache` — resolved day has no row; assert normal `fetchRate` → `insertIfAbsent` flow still runs and returns the freshly-stored rate (reuses the existing `FETCHED`/`STORED` fixtures already in the file).

**File**: `libs/integrations/fx/src/infrastructure/adapters/__tests__/nbp-exchange-rate.adapter.spec.ts` (existing file — add cases, do not create a new one)
- `resolveLikelyPublicationDay` returns the Friday before a Saturday candidate.
- `resolveLikelyPublicationDay` returns the candidate itself for an ordinary working day.

**File**: `libs/integrations/fx/src/infrastructure/adapters/__tests__/ecb-exchange-rate.adapter.spec.ts` (existing file — add cases)
- `resolveLikelyPublicationDay` returns the Friday before a Saturday candidate.
- `resolveLikelyPublicationDay` returns **the Corpus Christi date itself** (`'2026-06-04'`) — proving no Polish-calendar dependency, per the issue's explicit acceptance criterion.
- `resolveLikelyPublicationDay` returns the candidate itself for an ordinary weekday.

**File**: `libs/integrations/fx/src/infrastructure/adapters/__tests__/fake-exchange-rate.adapter.spec.ts` (if it exists — otherwise skip; the Fake is trivial enough that its identity behaviour is implicitly covered by every existing `CurrencyRateService` spec that uses it)
- `resolveLikelyPublicationDay` returns the input unchanged.

### Integration Tests
None required — this is a pure, no-I/O calendar computation wired into an existing, already-integration-tested cache-read path. No new HTTP surface, no new DB shape.

### Mocking Strategy
- `CurrencyRateService` specs mock `ExchangeRateProviderPort` and `ExchangeRateRepositoryPort` exactly as the existing spec file already does (`jest.Mocked<...>`), adding `resolveLikelyPublicationDay` to the mock only in the tests that need to exercise it — the "declares nothing" test uses a mock object that simply omits the property, which is what proves the probe (not a type check) governs behaviour.
- Adapter specs test the two new methods directly against the real adapter instance — no HTTP mocking needed since the method makes no HTTP calls.

### Acceptance Criteria (mirrors the issue's own AC list)
- [ ] `ExchangeRateProviderPort` declares the optional method, documented with the `<= candidate` / "no publication day in between" contract.
- [ ] `CurrencyRateService` probes for the method (`typeof provider.resolveLikelyPublicationDay === 'function'`) rather than relying on the type, with a comment citing the ADR-046 precedent.
- [ ] A spec proves a Saturday candidate resolves to the preceding Friday and the pre-fetch `findByKey` is called with the Friday, with zero `fetchRate` calls when that row exists.
- [ ] A spec proves a provider declaring nothing behaves exactly as today (read keyed on the candidate).
- [ ] A spec proves a wrong/missing resolution degrades to a `fetchRate` call and never to a wrong or stale stamp.
- [ ] The NBP adapter reuses `resolveWorkingDayAtOrBefore` — no second copy of the Polish working-day calendar.
- [ ] The ECB adapter's variant is weekend-only, with a comment stating why it must not use the Polish calendar (citing the verified Corpus Christi 2026-06-04 divergence).
- [ ] `CurrencyRateService`'s file header no longer describes the permanent-miss case as accepted debt, and ADR-040 § Consequences is updated to match.
- [ ] Tests added or updated for non-trivial logic.
- [ ] No architecture boundary violations (CORE ↔ Integration).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions) — reuses NBP's calendar method verbatim, follows the ADR-046 probe precedent verbatim
- [x] Idempotency considered — the change only affects which key is read; writes remain governed by the existing `insertIfAbsent`/`DuplicateExchangeRateError` idempotency path, untouched
- [ ] Event-driven patterns used where applicable — N/A, no events involved
- [x] Rate limits & retries addressed — the fix *reduces* outbound provider calls; no new retry logic needed since the existing `RateUnavailableTransientError`/`RateUnsupportedPairError` classification is untouched
- [x] Error handling comprehensive — no new error paths introduced; existing exceptions propagate unchanged
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards — no new files needed
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview § 18. Currency](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [ADR-040: Order-time FX stamping against a system reporting currency](../architecture/adrs/040-order-time-fx-stamping-against-a-system-reporting-currency.md)
- [ADR-046: Adapter-declared description format](../architecture/adrs/046-adapter-declared-description-format.md) — the probe-not-trust precedent this issue explicitly follows
