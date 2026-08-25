# Decision: data-coverage remediation model for `/analytics` (Data Coverage panel)

**Date**: 2026-08-25
**Issue**: #2455 (Phase 1 Task 1.2 of epic #2452)
**Sibling decisions**: [ADR-064](../architecture/adrs/064-analytics-display-currency-conversion.md) (display-currency conversion), [ADR-063 Amendment (#2456)](../architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md#amendment-2456-2026-08-25-query-time-opt-in-for-backfilled-pre-rollout-tax-rates-in-net-sales) (tax-rate query-time setting)

## Problem

The Data Coverage panel needs a shared status vocabulary for "is this exclusion category fixed yet," and a shared audit table for the one category that runs as a real background job (currency re-stamping). Both need to be pinned once so Phase 4 (detection), Phase 5 (remediation), and Phase 7 (frontend) build against the same contract instead of re-deriving it independently.

## Decision 1 — `CoverageResolutionStatus` is lifecycle-only; tone is derived separately

```ts
export const CoverageResolutionStatusValues = ['open', 'in-progress', 'resolved', 'failed'] as const;
export type CoverageResolutionStatus = (typeof CoverageResolutionStatusValues)[number];

export function deriveCoverageDisplay(
  status: CoverageResolutionStatus,
  category: string,
): { tone: 'success' | 'warning' | 'critical'; label: string } {
  // pure mapping — no I/O, colocated per the pure-rule exception in
  // docs/engineering-standards.md, e.g. *.types.ts alongside the union it derives from
}
```

An earlier design pass proposed folding outcome and lifecycle into one compound value — in the requester's own words, *"moze status po prostu? i to bedzie status success-closed czy cos konczocay wszystkei statusy, bedzie tez succes-unclosed, warning itp itd"* (a single status like `success-closed` / `success-unclosed` that names both the outcome and whether the row has been dismissed). That was rejected: a compound string forces every new tone/lifecycle combination to mint a new literal, and the two axes change for different reasons (a run's lifecycle is a fact about the job; its tone is a rendering choice). The codebase already has this exact split precedent in `deriveOrderHealth` and `ConnectionIngestionStatus` — one closed lifecycle union, one pure function deriving display tone from it. `CoverageResolutionStatus` follows the same shape.

## Decision 2 — `analytics_remediation_runs` tracks the currency category only

```sql
CREATE TABLE analytics_remediation_runs (
  id             text PRIMARY KEY,          -- ol_remrun_{uuid}
  category       text NOT NULL,             -- open string, not a closed enum — see below
  status         text NOT NULL,             -- CoverageResolutionStatus
  detail         text NULL,                 -- populated on 'failed'; mirrors sync_jobs.lastError / salesDocumentBlockDetail
  affected_count integer NOT NULL,
  triggered_by   text NOT NULL,             -- user id
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- partial unique index: at most one open/in-progress run per category at a time
```

`category` stays an open `string` column (not a closed literal union at the DB layer) so a future genuinely-async category can reuse the table without a migration — but **nothing in this epic other than the currency category writes a row here**. This is the key scoping decision: the tax-rate side never needed this table at all, once the mechanism (see Decision 3 below) turned out to be a synchronous settings toggle rather than a tracked run.

## Decision 3 — the tax-rate fix is a query-time setting, not a tracked run (supersedes an earlier per-order design)

An intermediate design sketch (before this was reconciled against the ADR-063 amendment) described a per-order "confirm" action that would mutate `taxRateEra` — a one-way, per-order data write, explicitly warned against with a "this can't be undone" confirmation dialog. **This design did not survive review** and is superseded by [ADR-063's amendment](../architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md#amendment-2456-2026-08-25-query-time-opt-in-for-backfilled-pre-rollout-tax-rates-in-net-sales): a single global, off-by-default, instantly-reversible query-time setting that never touches `order_records`. Because it is a settings write rather than a data-repair job, it needs no `analytics_remediation_runs` row, no lifecycle, and no polling — the very next `/analytics` read reflects the change.

The one legitimate *tax-side* action that does trigger real work is category C's "re-run backfill now" (see Phase 5 Task 5.2) — but it is a fire-and-forget trigger of the existing scheduled `TaxRateBackfillService`, not a tracked run either: a backfill attempt is idempotent, so there is nothing to poll and nothing that can be left "stuck in progress."

## Mockup-state → lifecycle-value mapping (source of truth for Phase 7 and Phase 9)

| Mockup `data-state` | `CoverageResolutionStatus` | Category |
|---|---|---|
| `detail-currency` | `open` | currency |
| `currency-in-progress` | `in-progress` | currency |
| `currency-fixed` | `resolved` (shown transiently, row then removed from the list) | currency |
| `currency-failed` | `failed`, `detail` populated | currency |
| `all-clear` | no open/in-progress rows in any category | — |
| `settings-open` / `tax-confirm` | not modeled by this table at all — pure settings state | tax (A) |
| `detail-tax` / `detail-novat` / `detail-postrollout` | not modeled by this table — derived live from the existing `netExcludedCount` population each read | tax (A/B/C) |

A `resolved` row's disappearance is driven by the real `UPDATE analytics_remediation_runs SET status = 'resolved'` completing on the worker side, never a client-only timer — the UI's brief "Fixed — closing…" sub-state is cosmetic delay on top of a real state transition, not a substitute for one. The resulting success confirmation renders as a dismissible, green, **inline** notice inside the Data Coverage section (the `.coverage-alert` pattern) — an earlier toast-based sketch was rejected in the requester's own words: *"zamiast toasta mial pozostawac notifcation w sekcji data coverage tylko miec opcje zamkniecia... i mial sie robic na zielono"* (instead of a toast, it should stay as a notification in the Data Coverage section with just a close option, and render green).

## Consequences

- Phase 4's detection endpoint reports categories using the plain lifecycle status above — currency and (informational) product-matching rows may show `open`/`in-progress`/`resolved`/`failed`; the three tax sub-categories are always reported live, never as a stored run.
- Phase 5 implements exactly one `analytics_remediation_runs`-tracked action (currency bulk recalculation) and zero tracked tax actions.
- Phase 7's polling logic (`refetchInterval`) is scoped to the currency category only — there is nothing to poll on the tax side.
