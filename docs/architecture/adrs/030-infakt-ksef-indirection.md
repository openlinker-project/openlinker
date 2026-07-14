# ADR-030: Infakt as a KSeF intermediary — `RegulatoryStatusReader`, not `RegulatoryTransmitter`

- **Status**: Accepted
- **Date**: 2026-07-02
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made across PRs #1275, #1292, #1293)

## Context

inFakt is a Polish accounting SaaS and the second provider of the country-agnostic
**Invoicing** domain ([ADR-026](./026-country-agnostic-invoicing-domain.md)),
`@openlinker/integrations-infakt` (adapterKey `infakt.accounting.v1`). Like KSeF
(`@openlinker/integrations-ksef`) and Subiekt, it ultimately clears invoices through
Poland's national e-invoicing system, KSeF — but the three providers sit at three
different points on the "who owns the KSeF session" axis:

- **KSeF direct** (`@openlinker/integrations-ksef`): OL itself holds the NIP-authenticated
  KSeF session, builds the FA(3) XML, opens/submits/closes the session, and polls for the
  UPO. OL is the transmitter.
- **Subiekt**: a local desktop bridge auto-submits to KSeF on Subiekt's own schedule; OL
  only reads back the resulting status.
- **inFakt**: OL calls inFakt's REST API to *create* an invoice (`POST /invoices.json`),
  then explicitly triggers submission (`POST /invoices/{uuid}/send_to_ksef.json`) as an
  inline second step. From that point on, inFakt processes clearance using its own KSeF
  integration, on its own timing — OL never touches KSeF (the session, the FA(3) XML,
  or the UPO) directly for inFakt-issued documents.

The `RegulatoryTransmitter` sub-capability ([ADR-026 amendment](./026-country-agnostic-invoicing-domain.md#amendments))
models "submit for clearance + read status" as one capability, precisely because a
provider that *actively transmits* necessarily also needs to read back the authority
reference it just submitted for. inFakt breaks that assumption differently than it
first appears: OL's adapter **does** call an explicit submit primitive
(`POST /invoices/{uuid}/send_to_ksef.json`, inline inside `issueInvoice`/
`issueCorrection`) — verified live (2026-07-01) that an inFakt draft does **not**
auto-submit to KSeF on its own, so this call is what actually starts clearance. What
OL does not have is *ownership* of the submission: inFakt — not OL — still holds the
KSeF session, builds the FA(3) XML, and is the authority on clearance status. OL's
call only hands an already-created document to inFakt's own KSeF integration; it
carries no independent retry/timing semantics of its own the way a true
`submitForClearance()` would.

## Decision

`InfaktInvoicingAdapter` implements `InvoicingPort` + `RegulatoryStatusReader` +
`CorrectionIssuer` — **not** `RegulatoryTransmitter`.

- **No public `submitForClearance()`.** OL retains an out-of-port `sendToKsef` trigger
  (called inline by `issueInvoice`/`issueCorrection`, not exposed as a standalone port
  method) and does not surface it as a `RegulatoryTransmitter` method because clearance
  timing and status ownership stay with inFakt, not OL — a failed `sendToKsef` call
  after a successful create leaves an orphaned un-submitted document rather than a
  resumable submit step, and the actual clearance work (KSeF session, FA(3) XML, UPO)
  happens entirely inside inFakt's infrastructure. Clearance itself still completes on
  inFakt's own timing (confirmed live on sandbox, #1274: ~90s from the inline trigger).
- **Status polling via `getClearanceStatus()`.** The adapter reads
  `GET /invoices/{uuid}.json` and maps `invoice.ksef_data.status`
  (`pending | sent | success | error`) onto the neutral `RegulatoryStatus`
  (`submitted | submitted | accepted | rejected`; absent `ksef_data` → `not-applicable`).
  `success` maps to the terminal `accepted` state, not `cleared` — `cleared` is reserved
  for split-clearance regimes no current provider emits, and a `cleared` mapping here
  previously left the FE status badge stuck at "CLEARING" (#1293 review, live E2E
  finding).
- **Webhooks are a push-notification shortcut, not a transport.** inFakt fires
  `send_to_ksef_success` / `send_to_ksef_error` webhooks the moment its own KSeF
  submission resolves. `InfaktInboundWebhookDecoderAdapter` (ADR-021) decodes these
  and routes them to trigger an immediate `getClearanceStatus()` re-read rather than
  trusting the webhook payload as the system of record — the same "webhook = trigger,
  poll = reconciliation backstop" posture the PrestaShop order pipeline already uses.
  `invoice_marked_as_paid` / `invoice_marked_as_paid_via_async_api` (#1354) route the
  same way to the `invoice-payment` domain, triggering a `getPaymentStatus()` re-read
  via `PaymentStatusReader` instead — a sibling capability to `RegulatoryStatusReader`,
  added after this ADR was first written, for the same "webhook = trigger" reason.
  Every other inFakt event (e.g. `draft_invoice_created`) is acknowledged and ignored
  (`toOlDomain()` returns `null`).

## Alternatives considered

- **Build a direct KSeF session from the OL side, bypassing inFakt's own submission**
  (i.e. treat inFakt as a plain accounting API and drive KSeF the way
  `@openlinker/integrations-ksef` does). Rejected: requires OL to hold a second
  NIP-authenticated KSeF token + certificate per operator and to build FA(3) XML a
  second time for the same tenant — duplicate infrastructure inFakt already runs, for
  no operator benefit, and inFakt would still submit the invoice on its own schedule
  regardless, risking a double-submission race.
- **Disable KSeF integration in inFakt's account settings and drive KSeF directly from
  OL.** Viable as a fallback but rejected as the default: it throws away the one thing
  inFakt uniquely offers over direct KSeF — zero crypto/session management on OL's
  side — and would make the inFakt adapter a strictly worse KSeF adapter. Left as an
  operator escape hatch, not modeled in code.
- **Model `submitForClearance()` as a no-op that just calls `getClearanceStatus()`
  immediately**, to satisfy `RegulatoryTransmitter`'s interface shape. Rejected: it
  would lie about what the method does (nothing is "submitted" by calling it) and
  would let call sites believe OL controls submission timing, which it does not.

## Consequences

**Pros:**
- The capability the adapter declares (`RegulatoryStatusReader`) accurately reflects
  what OL can and cannot do — no misleading "submit" affordance that silently no-ops.
- Core call sites that narrow via `isRegulatoryTransmitter` correctly skip inFakt and
  never attempt a submit that has no meaning for this provider.
- The webhook-as-shortcut design means status usually reflects reality within seconds
  of inFakt's own submission, without OL polling on a tight interval.

**Cons / trade-offs:**
- OL cannot retry a failed `sendToKsef` call independently of re-issuing the document,
  and cannot control the timing of the clearance work itself once inFakt has accepted
  the submission — that part lives entirely inside inFakt's own KSeF integration.
- If KSeF integration is disabled in the operator's inFakt account settings, the
  explicit `sendToKsef` call OL makes fails outright rather than silently degrading;
  `regulatoryStatus` on every inFakt invoice then stays `not-applicable`. There is no
  code path to notice and warn about this misconfiguration ahead of time — it's an
  operational, bookkeeping-side setting, not one OL surfaces or should re-implement
  (raised, not fixed, in the
  [setup guide](../../../libs/integrations/infakt/docs/setup-guide.md#troubleshooting)).

## Amendments

- **2026-07-06 — `RegulatoryResubmitter` (#1356).** This ADR's "Cons" section noted OL
  "cannot retry a failed `sendToKsef` call independently of re-issuing the document."
  `RegulatoryResubmitter.resubmitForClearance` closes that specific gap for the
  operator-facing case: it re-hits `send_to_ksef.json` for the SAME
  `providerInvoiceId` (never re-POSTs `invoices.json`, so it cannot double-issue) and
  backs a "resend to KSeF" action gated to documents whose clearance ended in
  `rejected`. It is a NEW, independent sub-capability, not a retrofit of
  `RegulatoryTransmitter` — the decision above (no public `submitForClearance()`)
  stands unchanged; a resubmitter is deliberately modeled `flat` (does not `extends
  RegulatoryStatusReader`) precisely because it does not imply OL owns the session the
  way a transmitter would. See `docs/capabilities.md` for the sub-capability's full
  contract.

## References

- Related issues: #1279 (epic), #1274/#1275 (feasibility POC), #1280/#1292 (adapter
  hardening), #1281/#1293 (registration + webhook routing), #1283 (this ADR)
- Related ADRs: [ADR-026](./026-country-agnostic-invoicing-domain.md) (country-agnostic
  invoicing domain + the `RegulatoryTransmitter`/`RegulatoryStatusReader` split),
  [ADR-021](./021-third-party-native-inbound-webhook-ingestion.md) (per-provider inbound
  webhook decoder — how the `send_to_ksef_*` events reach OL)
- Primary doc section: [docs/architecture-overview.md § 14 Invoicing](../../architecture-overview.md#14-invoicing)
- Operator guide: [libs/integrations/infakt/docs/setup-guide.md](../../../libs/integrations/infakt/docs/setup-guide.md)
