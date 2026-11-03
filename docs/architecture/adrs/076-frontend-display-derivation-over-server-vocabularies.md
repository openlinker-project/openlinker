# ADR-076: A frontend may derive a display sentence from server-owned vocabularies, never legality

- **Status**: Accepted
- **Date**: 2026-09-28
- **Authors**: @norbert-kulus-blockydevs

## Context

`fulfillment.types.ts` states the standing rule for the fulfilment-task frontend plainly:
`supportedActions`, `status` and `requestStatus` are closed unions in `@openlinker/core/fulfillment`,
and *"no code branches on these values"* — they are looked up in a loose copy table that falls back
to the raw string. `scripts/check-no-supported-actions-mirror.mjs` fails the build on any frontend
declaration of that union, because DESIGN §5.2's whole argument for the server-computed
`supportedActions` array is that it *"kills client-side state-machine drift across heterogeneous
executors"* — there is nothing this app may correctly decide from `status` or `requestStatus` alone.

The fulfilment work detail page (#3096) needs a plain-language sentence under the hero's two raw
axis labels — a held task reads `status: 'open'` with a non-empty `activeHolds`, because nothing
writes `status = 'on_hold'`, so the raw status alone can actively mislead. Producing that sentence
(`fulfillment-work-summary.ts`, #3099) means reading `status`, `requestStatus`, `activeHolds.length`
and `cancellationReason`, and branching on their combination with an ordered precedence. That is
either a violation of the standing rule or a narrowing of it, and which one it is had to be decided
before the code was written, not discovered by whichever reviewer reads it first.

## Decision

**The frontend may derive a DISPLAY sentence from server-owned vocabularies, and may never derive
LEGALITY.** Controls keep coming from `supportedActions` alone, exactly as before — nothing about
this ADR touches that. `summariseFulfillmentWork` takes a narrow seven-field struct (never the whole
`FulfillmentTask`, so `supportedActions` is structurally unreachable from inside it) and returns a
sentence or `null`. A `(status, requestStatus)` combination this build does not recognise renders
**no sentence**, never a guessed or hedged one — the same fail-safe direction `fulfillmentActionHint`
already takes by returning `null` rather than a fabricated tooltip. The hero's two raw axis labels
always render regardless, so the page is never blank; only the derived line under them is
conditional. This is a **narrowing** of `check-no-supported-actions-mirror.mjs`'s rule, not an
exception to it: that script still fails the build on any frontend declaration of the
`FulfillmentWorkStatus` / `FulfillmentRequestStatus` / `FulfillmentWorkAction` unions themselves, and
nothing about this decision asks it to stop.

## Alternatives considered

- **Render only the two raw axis labels, no derived sentence at all.** Rejected: a held task reads
  `Open · Accepted` with the hold itself only visible three sections further down the page, which is
  precisely the misleading half-truth the detail page exists to correct. The whole point of a
  detail page over the worklist's compact card is room to explain a state, and declining to use it
  wastes the page.
- **Let the derivation take the whole `FulfillmentTask` and read `supportedActions` for extra
  context.** Rejected: a function with the array in scope can drift into treating its contents as
  informative about state rather than only about legality, and that is exactly the client-side
  state-machine drift the guard script cannot catch statically — its own docblock says as much,
  since one `if` inside a caller is invisible to a regex. A narrow input struct makes the drift
  unreachable rather than merely discouraged.
- **Widen `check-no-supported-actions-mirror.mjs` to permit a `Record` keyed on the union, gated by
  a lint-suppressing comment per site.** Rejected: a suppression comment is a promise nobody re-reads,
  where a narrow function signature is a promise the type checker re-reads on every build.

## Consequences

**Pros:**
- One documented seam (`FulfillmentWorkSummaryInput`) for "what may a display derivation read",
  reusable the next time a fulfilment surface wants a plain-language state.
- The fail-safe direction (silence over a fabricated claim) is stated once, here, rather than
  re-justified at each call site that needs it.

**Cons / trade-offs:**
- Two real, reachable states currently render no sentence at all (`open` + `unsubmitted` with a
  location and no holds — the commonest state a freshly routed task is in; and
  `requestStatus: 'rejected'`). This is accepted rather than closed by inventing copy for states the
  design of record has no worked example for; a later slice may add sentences for them without
  touching this ADR. `open` + `accepted` was a third until #3096 gave it `acceptedWaiting`, because
  it is the state most live tasks sit in and a hero with nothing under its headline read as broken.
- A sixth, seventh, … axis value the backend adds silently produces no sentence here until a
  frontend change adds one. That degradation (silence, not a crash and not a wrong claim) is the
  entire point of the rule, so it is not treated as a gap to close.

## References

- Related issues: #3096, #3099, #3247
- Related ADRs: none — this is the first ADR for `features/fulfillment`'s frontend layer
- Primary doc section: [docs/frontend-architecture.md § fulfillment](../../frontend-architecture.md)
