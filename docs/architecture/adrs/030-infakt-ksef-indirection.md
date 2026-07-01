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
- **inFakt**: OL calls inFakt's REST API to *create* an invoice (`POST /invoices.json`).
  inFakt then submits that invoice to KSeF **on its own**, on its own timing, using its
  own KSeF integration — OL never touches KSeF directly for inFakt-issued documents.

The `RegulatoryTransmitter` sub-capability ([ADR-026 amendment](./026-country-agnostic-invoicing-domain.md#amendments))
models "submit for clearance + read status" as one capability, precisely because a
provider that *actively transmits* necessarily also needs to read back the authority
reference it just submitted for. inFakt breaks that assumption: OL has no submit
primitive to call at all — clearance happens as a side effect of inFakt's own invoice
lifecycle, entirely outside OL's control.

## Decision

`InfaktInvoicingAdapter` implements `InvoicingPort` + `RegulatoryStatusReader` +
`CorrectionIssuer` — **not** `RegulatoryTransmitter`.

- **No `submitForClearance()`.** There is nothing for OL to submit; inFakt auto-triggers
  KSeF submission the moment `POST /invoices.json` succeeds (confirmed live on sandbox,
  #1274: clearance completes in ~90s with zero further OL action).
- **Status polling via `getClearanceStatus()`.** The adapter reads
  `GET /invoices/{uuid}.json` and maps `invoice.ksef_data.status`
  (`pending | sent | success | error`) onto the neutral `RegulatoryStatus`
  (`submitted | submitted | cleared | rejected`; absent `ksef_data` → `not-applicable`).
- **Webhooks are a push-notification shortcut, not a transport.** inFakt fires
  `send_to_ksef_success` / `send_to_ksef_error` webhooks the moment its own KSeF
  submission resolves. `InfaktInboundWebhookDecoderAdapter` (ADR-021) decodes these
  and routes them to trigger an immediate `getClearanceStatus()` re-read rather than
  trusting the webhook payload as the system of record — the same "webhook = trigger,
  poll = reconciliation backstop" posture the PrestaShop order pipeline already uses.
  Every other inFakt event (`draft_invoice_created`, `invoice_marked_as_paid`, …) is
  acknowledged and ignored (`toOlDomain()` returns `null`).

## Alternatives considered

- **Build a direct KSeF session from the OL side, bypassing inFakt's own submission**
  (i.e. treat inFakt as a plain accounting API and drive KSeF the way
  `@openlinker/integrations-ksef` does). Rejected: requires OL to hold a second
  NIP-authenticated KSeF token + certificate per operator and to build FA(3) XML a
  second time for the same tenant — duplicate infrastructure inFakt already runs, for
  no operator benefit, and inFakt would still submit the invoice on its own schedule
  regardless, risking a double-submission race.
- **Disable inFakt's KSeF auto-submit setting and drive KSeF directly from OL.** Viable
  as a fallback (inFakt exposes this as an account-level setting) but rejected as the
  default: it throws away the one thing inFakt uniquely offers over direct KSeF — zero
  crypto/session management on OL's side — and would make the inFakt adapter a strictly
  worse KSeF adapter. Left as an operator escape hatch, not modeled in code.
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
- OL cannot control *when* an inFakt-issued invoice is submitted to KSeF, or retry a
  failed submission itself — that lever lives entirely in inFakt's account settings.
- If the operator disables inFakt's KSeF auto-submit (the documented fallback above),
  `regulatoryStatus` on every inFakt invoice stays `not-applicable` forever — there is
  no code path to notice and warn about this misconfiguration; it's an operational
  bookkeeping-side setting, not one OL surfaces or should re-implement (raised, not
  fixed, in the [setup guide](../../integrations/infakt/setup-guide.md#troubleshooting)).

## References

- Related issues: #1279 (epic), #1274/#1275 (feasibility POC), #1280/#1292 (adapter
  hardening), #1281/#1293 (registration + webhook routing), #1283 (this ADR)
- Related ADRs: [ADR-026](./026-country-agnostic-invoicing-domain.md) (country-agnostic
  invoicing domain + the `RegulatoryTransmitter`/`RegulatoryStatusReader` split),
  [ADR-021](./021-third-party-native-inbound-webhook-ingestion.md) (per-provider inbound
  webhook decoder — how the `send_to_ksef_*` events reach OL)
- Primary doc section: [docs/architecture-overview.md § 14 Invoicing](../../architecture-overview.md#14-invoicing)
- Operator guide: [docs/integrations/infakt/setup-guide.md](../../integrations/infakt/setup-guide.md)
