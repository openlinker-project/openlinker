# eparagony.pl Integration — Runbook

Day-2 operational reference for the eparagony.pl fiscalization adapter
(`eparagony.documents.v3`): known platform quirks, troubleshooting, and how to read
an `in-doubt` outcome. For first-time setup, see the [setup guide](./setup-guide.md).

This chapter is **not optional** the way it is for most adapters: the fiscalization
path depends on a physical printer reached through the vendor's own eDPS
intermediary, and operators will hit device-side failures OpenLinker cannot see
directly.

---

## Known platform quirks

- **The vendor's contract is not frozen.** New response fields may appear without
  notice, and the documented error-code list is not exhaustive — `errorCode: 92`
  was observed live for a missing document, with no corresponding entry in the
  vendor's own spec. If you see an `EparagonyApiError` with an unfamiliar
  `errorCode`, treat it as informative, not necessarily a defect.
- **`registerTransaction` can take up to about a minute.** `POST /documents`
  returns `202` immediately, and the adapter then polls the device's status to a
  terminal outcome inside a bounded budget. A slow response from the "Register
  receipt" button is expected, not a hang.
- **The device can confirm AFTER the poll budget expires.** Verified live against
  the sandbox: a registration that timed out `in-doubt` was later found
  `CONFIRMED` (real receipt number, signing identity, and a receipt-link
  artefact) by a subsequent "Look it up". This is normal, not a bug — resolve it
  by waiting and looking it up again, never by re-registering.
- **Sandbox has no attached fiscal device by default.** `GET
  /printers/{any}/status` returns a constant `INACTIVE` stub for any device
  number, so "Test connection" cannot demonstrate a live device — only that your
  credentials and granted scopes are correct. Sandbox documents DO eventually
  reach `CONFIRMED` (see above); what the sandbox cannot prove is a specific
  physical printer being reachable.
- **`Idempotency-Key` must be a vendor-safe token.** The adapter sends the
  derived `documentToken` (a UUID-shaped hash of `connectionId` +
  `idempotencyKey`), never core's raw key — the vendor rejects anything outside
  `/^[0-9A-Za-z_-]+$/`. If you are extending this adapter, do not change this
  back to the raw key.
- **No webhook ingress in v1.** The vendor can push a confirmed status by
  webhook, but this adapter relies entirely on the synchronous poll +
  `locateByQuery` reconcile path. A "Register receipt" that returns quickly with
  `registered` got there via the poll; there is no separate webhook delivery to
  troubleshoot yet.
- **The `POST /documents` retry-on-5xx/network safety assumes the vendor's
  `Idempotency-Key` dedup window outlives our own retry span.** The adapter
  sends the same derived `documentToken` as the header on every retried
  attempt (pinned by a unit test), and the vendor is documented to guarantee
  that repeating a key with the same body never mints a second document — but
  that guarantee is only as good as how long the vendor actually remembers the
  key. Our own retry span is small (a handful of seconds across the transport's
  bounded backoff), so this is safe against any dedup window measured in
  minutes or longer. If the vendor's dedup window ever turns out to be shorter
  than that, a retry could mint a second document; nothing in this codebase
  currently verifies the vendor's window length against our own retry span.
- **An invoice request needs BOTH tokens, or the vendor rejects it (`errorCode: 41`,
  `"documentToken" missing required peer "transactionToken"`).** A receipt request
  never needed `transactionToken`; the invoice path derives and sends both. If you are
  extending this adapter for a second document kind on one order, check whether it
  should share the transaction token with a sibling document rather than minting its
  own — the vendor's model allows several documents per transaction.
- **An invoice's line tax rate uses a different vocabulary than a receipt's.** The
  receipt-side letter codes (`A`-`G`) do not apply — an invoice line takes `23`, `8`,
  `5`, `3`, `ZRD`, `ZRICS`, `ZRE`, `EP`, `RCP`, `NS1`, `NS2`.
- **`merchantTIN` on an invoice is validated against the eparagony account's
  registered taxpayer, not by checksum.** A wrong value fails EVERY invoice on the
  connection with `errorCode: 41` / `"Incorrect merchantTIN"`, not one order — check
  the connection config first, not the order.
- **A KSeF-relayed invoice reaching `CONFIRMED` was never observed live in the
  sandbox** — it stayed `OFFLINE` past eight minutes on every test run. Coded from the
  vendor's own spec; if your production invoices never leave `pending-submission`
  either, first confirm the KSeF Taxpayer-App permission grant (setup guide, Step 3)
  is actually in place before assuming an adapter defect.

---

## Reading a failure

| `status` | `failureMode` | What it means | What to do |
|---|---|---|---|
| `failed` | `rejected` | The provider definitely created nothing (e.g. unresolvable tax rate, non-registrable amount). | Fix the cause, then register again — safe, because nothing exists to duplicate. |
| `failed` | `in-doubt` | The request was sent but the outcome could not be confirmed before the poll budget ran out, or a transport failure happened after send. | **Never register again for this order/connection pair on this basis alone.** Use "Look it up" (`locateByQuery`) — it asks the provider by the same deterministic document reference, never by resubmitting. If it still reports nothing, wait and try again; the device may simply be slower than the poll budget. |

A check reports one of four outcomes (`FiscalReconcileOutcome`), and only the
first changes the record:

- `resolved` — the provider confirmed a registration; the record advances.
- `not-found` — no registration exists for these coordinates. Stays `in-doubt`.
  This does NOT mean the provider holds nothing: a document it reports in
  `ERROR` answers here too, because a failed document is an absence of a
  registration rather than work still in progress.
- `still-unknown` — the check settled nothing. Usually the provider holds the
  sale at a non-terminal status and simply has not registered it yet; the same
  outcome also covers an answer OpenLinker could not read, which is marked
  `detail: "unreadable-answer"`. Stays `in-doubt`; check again later.
- `unsupported` — this provider cannot be queried this way. Falls to manual
  operator handling (check the vendor's own panel).

A failed CHECK is deliberately none of the four: if the provider could not be
reached at all, the endpoint answers HTTP 502, nothing is written, and the check
can be repeated.

---

## Troubleshooting

- **"Connection test passed" but every registration comes back `in-doubt`.**
  The test only proves OAuth + granted scopes — it does not exercise a real
  device. Confirm with your printer servicer that the device is genuinely
  configured for e-receipts (OpenLinker cannot verify this remotely), and check
  that the vendor's printer-control software is running on the machine next to
  the printer.
- **400 on every registration attempt.** Check the connection's `posId` — the
  vendor stamps it on every document and rejects a wrong one (`errorCode: 43`).
- **A line is rejected for its tax rate.** The connection's `taxRates` table
  describes what YOUR device is programmed with; OpenLinker cannot observe the
  device, so a mismatch between the catalogue's rate code and the device's
  actual configuration surfaces as a rejection. Fix the `taxRates` config or set
  a `defaultTaxRateCode` for lines with no resolved rate.
- **Repeat registrations of the same order 409.** This is correct, not a bug —
  the order already carries a non-`rejected` registration on some connection.
  See [ADR-042 decision 6](../../../../docs/architecture/adrs/042-fiscalization-capability.md).
- **An invoice stays `pending-submission` with no retry button.** This is by design —
  the vendor's API has no call that (re-)triggers KSeF submission, and a fiscal
  document is a legal event that must not be resubmitted speculatively. If it never
  advances, confirm the KSeF Taxpayer-App permission grant is actually in place
  (setup guide, Step 3) before treating it as an adapter fault.
- **An invoice fails with `errorCode: 41` naming `merchantTIN`.** The connection's
  `merchantTIN` does not match the taxpayer registered on the eparagony account — fix
  the connection config, not the order; every invoice on this connection is affected.
- **An invoice fails with a missing-`transactionToken` error.** This would indicate a
  regression in the adapter, not an operator misconfiguration — every invoice request
  derives and sends both `documentToken` and `transactionToken` together. Report it.

## Rotating credentials

Static OAuth2 client-credentials (`clientId` / `clientSecret`). Rotate by
requesting new credentials from eparagony.pl and updating the connection's
credentials in OpenLinker — no OAuth refresh flow to manage.
