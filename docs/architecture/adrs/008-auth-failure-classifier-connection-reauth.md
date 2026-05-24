# ADR-008: Marketplace-agnostic auth-failure classifier for connection re-auth flagging

- **Status**: Accepted
- **Date**: 2026-05-24
- **Authors**: @piotrswierzy

## Context

When an OAuth connection's credentials are rejected server-side (e.g. Allegro returns
`400 invalid_grant` on token refresh), every job on that connection fails authentication and is
marked dead. Nothing flagged the connection, so it stayed `status='active'` and the scheduler kept
enqueuing jobs that died immediately — indefinitely, with no operator-facing signal (#819). The
offer-status sync (#818) made this hourly-visible.

The fix needs the `SyncJobRunner` — which is marketplace-agnostic and must not import
`AllegroAuthenticationException` — to recognise, at the dead-job boundary, that a *specific*
terminal failure is a **credential rejection** (re-auth required) as opposed to any other
non-retryable failure (a deterministic `422`, an `OfferCreationInvariantException`). The
terminal-vs-transient distinction is already encoded upstream: the Allegro HTTP client throws a
retryable `AllegroNetworkException` for transient refresh blips and `AllegroAuthenticationException`
only for genuine credential rejection (#499). So the runner just needs a way to classify the
exception type without coupling to the plugin.

## Decision

Add a dedicated `AuthFailureClassifierPort` (`isCredentialRejected(cause)`) plus an
`AuthFailureClassifierRegistryService` in `libs/core/src/sync`, exposed on the plugin contract's
`HostServices` bag — a direct parallel of the existing `RetryClassifierPort` /
`RetryClassifierRegistryService` seam (#581). Plugins register their classifier in `register(host)`;
the runner OR-aggregates across registered classifiers. On a terminal credential rejection the runner
flags the originating connection (`active → needs_reauth`, guarded + best-effort), which the
scheduler's `status:'active'` filter then excludes. A new `needs_reauth` connection status (distinct
from the overloaded `error`) carries the precise signal to the FE re-auth banner.

## Alternatives considered

- **Extend `RetryClassifierPort` with a second method.** Rejected: conflates retry policy with
  auth/credential semantics on one port, and both are answered at different decision points. A focused
  single-responsibility port reads better and lets platforms opt in independently.
- **Neutral `CredentialsRejectedError` thrown by plugins, caught structurally in core.** Rejected:
  forces every plugin to translate its own exception into a core error type deep in its HTTP stack;
  the classifier-registry precedent keeps plugin exceptions plugin-owned and core classification-only.
- **Duck-typed marker property on the exception (`err.credentialsRejected === true`).** Rejected:
  less explicit than a port and inconsistent with the established registry pattern, for marginal
  wiring savings.
- **Reuse `status='error'` instead of `needs_reauth`.** Rejected: `error` is used for other failure
  modes, so the FE couldn't distinguish "re-authenticate" from a generic error without a second field.

## Consequences

**Pros:**
- Core/runner stay free of any Allegro import; the seam works for any future OAuth integration.
- Mirrors a contract the codebase already proves out (#581) — low conceptual cost for reviewers and
  plugin authors.
- Scheduler halts dead-job churn automatically via the existing active-only filter; no scheduler change.
- `needs_reauth` is a string-column value — **no DB migration**.

**Cons / trade-offs:**
- Adds one field to the `HostServices` contract — every host-bag assembly site must wire it (enforced
  by type-check). This is the deliberate cost of keeping the seam marketplace-agnostic.
- A second classifier registry sits alongside the retry one; the two are correlated but intentionally
  separate.

**Migration path (if applicable):**
- PrestaShop (API-key, non-OAuth) does not register a classifier yet — it never reaches `needs_reauth`
  today. It can adopt the port later with no core change.

## References

- Related PRs: #819
- Related issues: #819, #818, #499, #447
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md), [ADR-003](./003-plugin-sdk-trust-model.md), [ADR-007](./007-syncjob-status-vs-outcome-split.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
