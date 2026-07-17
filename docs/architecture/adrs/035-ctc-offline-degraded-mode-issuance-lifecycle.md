# ADR-035: CTC offline / degraded-mode issuance lifecycle

- **Status**: Proposed
- **Date**: 2026-07-16
- **Authors**: @norbert-kulus-blockydevs

## Context

Continuous-Transaction-Controls (CTC) clearance regimes let a seller *issue* a
document with legal effect even while the clearance authority is unreachable,
provided the seller transmits it once the authority returns within a bounded
grace window. KSeF is the concrete driver (its `offline24` degraded mode), but
this is a general regime property — IT SDI, and several other national CTC
systems, expose analogous outage-tolerance windows.

Two failure shapes follow from this and are not currently modelled in the
country-agnostic invoicing domain (ADR-026):

1. **Deferred submission.** A document issued during an outage has no neutral
   status to sit in. `submitted` is a lie (nothing was transmitted); `issued`
   conflates the issuance lifecycle with the clearance lifecycle. There is no
   state that says "legally issued, transmission owed".
2. **Crash mid-submit.** A process can die between transmitting a document and
   persisting the authority's acknowledgement. On restart OL cannot tell from
   its own state whether the authority received the document — re-issuing risks
   a duplicate, doing nothing risks a permanently un-cleared document.

This part (#1700, part 1 of mini-epic #1585) lays only the neutral domain
foundation the KSeF adapter (part 2) and the two sweep jobs (parts 3-4) build
on. No infrastructure, migration, or adapter code lands here.

## Decision

Add one neutral status and two optional sub-capabilities to `libs/core`:

- **`RegulatoryStatus = 'pending-submission'`** — the deferred-submission state
  (issued, transmission owed). Added to `RegulatoryStatusValues`; deliberately
  **not** added to `TerminalRegulatoryStatusValues` (a sweep must keep advancing
  it). The name is regime-neutral on purpose — it is not `offline24`-shaped, so
  a future non-PL CTC adapter reuses the same state for its own outage window.
- **`OfflineResubmitter`** (`resubmit(record) → OfflineResubmitResult`) — the
  degraded-mode retransmission seam. The sweep narrows an `Invoicing` adapter
  with `isOfflineResubmitter` and resubmits each `pending-submission` document,
  advancing it to `submitted` (or a synchronous verdict). The result carries the
  full `{ regulatoryStatus, providerInvoiceId, clearanceReference }` triple
  because an offline issuance could not know the authority reference at issue
  time.
- **`RegulatoryRecordLocator`** (`locateByQuery(criteria) → RegulatoryLocateResult
  | null`) — the last-resort crash-recovery lookup. It queries the authority by
  neutral business coordinates (`sellerTaxId` / `documentNumber` / issue-date
  window) to answer "did the authority receive it?". `null` means no match found,
  so the caller treats the interrupted attempt as never having landed.

Two service tokens (`OFFLINE_RESUBMISSION_SERVICE_TOKEN`,
`PENDING_RECOVERY_SERVICE_TOKEN`) are declared now; their implementations land in
parts 3-4.

**v1 scope**: only the KSeF `offline24` degraded mode. The `offline` and
`awaria` (authority-declared-outage) regimes are deferred — the neutral surface
above already accommodates them without change.

**Status-code ambiguity ("confirm or add safety net")**: KSeF's status codes do
not always unambiguously distinguish "received, processing" from "never
received". Rather than gamble on a code reading, the design pairs the primary
status read with the `RegulatoryRecordLocator` query fallback as a safety net:
when the code is ambiguous, the recovery sweep confirms against the authority's
own record before deciding to resubmit, so an ambiguous code never causes a
double-issue.

## Alternatives considered

- **Reuse `submitted` for offline-issued documents.** Rejected — it asserts a
  transmission that never happened, so the reconciliation poller (#1121) would
  wrongly treat the document as in-flight and never resubmit it.
- **A KSeF-named status (`offline24`) / KSeF-named capability.** Rejected — it
  would put regime vocabulary in `libs/core`, violating ADR-026, and would not
  generalise to other CTC regimes' outage windows.
- **Reuse the existing `RegulatoryResubmitter` (#1356).** Rejected — that
  capability re-triggers a *rejected* document on a natively-transmitting
  provider (operator "resend"). Offline resubmission is a different trigger
  (degraded-mode grace window, sweep-driven, `pending-submission` source state)
  and returns a wider result triple. Keeping them as distinct flat capabilities
  avoids overloading one method with two lifecycles.
- **Crash recovery by OL-side bookkeeping only.** Rejected — OL cannot know
  authority-side receipt after a mid-submit crash; only the authority can
  confirm, hence `RegulatoryRecordLocator`.

## Consequences

**Pros:**
- Neutral, regime-agnostic outage tolerance — a future non-PL clearance-regime
  adapter reuses `pending-submission` + both capabilities unchanged.
- Optional capabilities: providers with no degraded mode simply don't implement
  them, and the sweeps skip those connections (ADR-002 posture).
- The query fallback removes the double-issue risk from ambiguous status codes.

**Cons / trade-offs:**
- One more non-terminal state the reconciliation predicate and any future
  partial index must account for.
- `RegulatoryRecordLocator` depends on the authority exposing a query surface;
  an adapter without one cannot confirm receipt, so its `pending-submission`
  records are NOT blind-resubmitted (fiscal safety) — they are surfaced for
  manual handling instead.
- A `pending-submission` document is the ONLY copy of a legally-issued invoice
  and dwells in the `sourceDocument` column (base64, not encrypted) until the
  authority recovers. Accepted for v1; application-level at-rest encryption /
  post-window purge is a tracked follow-up.
- The resubmitted document is the plain online-mode FA(3); explicit offline-mode
  marking (verification/QR data) is deferred with the `offline`/`awaria` regimes.

**Migration path (if applicable):**
- Additive only. `pending-submission` is a new enum value; no existing record
  carries it until part 2 issues one. No migration in this part.

## References

- Related issues: #1700, #1585
- Related ADRs: [ADR-026](./026-country-agnostic-invoicing-domain.md), [ADR-002](./002-capability-ports-with-sub-capabilities.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § 14 Invoicing
