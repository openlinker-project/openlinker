# @openlinker/integrations-eparagony

OpenLinker's first `Fiscalization` adapter ([ADR-042](../../../docs/architecture/adrs/042-fiscalization-capability.md)),
fronting the **eparagony.pl Documents REST API v3**.

- **adapterKey**: `eparagony.documents.v3`
- **platformType**: `eparagony`
- **capability**: `Fiscalization` (+ the `FiscalRegistrationLocator` sub-capability, narrowed at the call site)

eparagony.pl is an e-receipt **distribution hub** fronting vendor software that drives the seller's own
online fiscal printer. This adapter hands a completed sale to a registering mechanism somebody else
operates. **OpenLinker is never the issuer** and never performs a fiscal registration itself.

## Endpoint mapping

| Neutral surface | Vendor endpoint |
|---|---|
| `FiscalizationPort.registerTransaction` | `POST /documents` (`eReceipt`, `Idempotency-Key` header) then a bounded poll of `GET /documents/{documentToken}/status` |
| `FiscalRegistrationLocator.locateByQuery` | `GET /documents/{documentToken}/status`, on a token re-derived from `criteria.idempotencyKey` |
| `ConnectionTesterPort.test` | `POST /auth/token`, plus an optional non-failing `GET /printers/{nr}/status` diagnostic |
| bearer acquisition (internal) | `POST /auth/token` on `login[.sandbox].eparagony.pl` |

**Not implemented, each for a stated reason.** `GET /documents/{t}/jws` and
`GET|POST /printers/{nr}/reports/daily` need the `document_get_jws` / `report_fiscal_get` scopes, which are
**refused for OpenLinker's client** - and because an ungranted scope fails the *whole* token request, asking
for them would break every call, not just those two. `GET /documents/{t}/actions/status` needs
`document_action_get` (not granted) and has no neutral counterpart. The vendor's invoice/KSeF lane belongs to
`InvoicingPort`, not here (ADR-042 decision 1).

## Connection setup

`Connection.config`:

| Field | Required | Notes |
|---|---|---|
| `environment` | yes | `sandbox` \| `production`. Selects both the API host and the separate OAuth host. |
| `posId` | yes | Vendor-assigned store/register id. A wrong value surfaces as `errorCode: 43`. |
| `defaultTaxRateCode` | no | See *Tax rates* below. Without it, an un-rated line **blocks** the registration. |
| `taxRates` | no | Partial `A`-`G` -> rate override of the default Polish slot table. |
| `print` | no | Ask the vendor's print service for a paper receipt too. Defaults to `false`. |
| `paymentForm` / `paymentName` | no | Declared payment form. Defaults to `Przelew`. |
| `statusPollTimeoutMs` | no | Clamped to 5-90 s. |
| `fiscalDeviceUniqueNumber` | no | Diagnostic only - lets "Test connection" also report device liveness. |
| `apiBaseUrl` / `authBaseUrl` | no | https-only overrides, for testing. |

Credentials (encrypted at rest): `clientId`, `clientSecret`, and an optional `integrationId` of the form
`<integration>:<secret>` sent as `X-Integration-Id`.

## Tax rates

The neutral `FiscalTransactionLine.taxRate` is a pass-through string, and OpenLinker never computes, infers or
defaults a rate (ADR-042 decision 8). The vendor needs **both** a per-line letter `A`-`G` **and** a
merchant-level letter -> rate table on every document. The adapter bridges the two:

1. a bare letter is passed through;
2. a rate string (`23`, `23.00`, `23%`, `ZW`) is matched against the configured table, numerically for
   percentages;
3. an **empty** rate resolves to `defaultTaxRateCode` if - and only if - the operator declared one.

Anything else blocks the registration with an operator-facing reason. Note that the core order-to-command
mapper currently emits `taxRate: ''` for **every** line, so today `defaultTaxRateCode` is effectively required
for this adapter to register anything. That is the ADR's intended behaviour while the per-line tax-rate
contract (#2054 / #2058) is outstanding, not a workaround.

## Failure classification

Classification is deliberately asymmetric towards `in-doubt`: a wrong `rejected` invites a resend, and a sale
registered twice is a legal event for the seller.

| Outcome | Mode |
|---|---|
| `POST /documents` -> 400 / 401 / 403 / 404 | `rejected` |
| `POST /documents` -> 400 with `errorCode: 118` | *resolved* - the document exists under our own deterministic token, so the status read decides |
| `POST /documents` -> 422 (key replayed with different data) | `in-doubt` - a document already exists |
| `POST /documents` -> 429 / 5xx / network / timeout | `in-doubt` |
| poll budget exhausted at `PENDING`/`READY` | `in-doubt` |
| any status-read failure after a successful create | `in-doubt` |
| terminal status `ERROR` | `rejected` |

`rejected` is safe here specifically because OL's own registration key is sent as the vendor's
`Idempotency-Key`: re-crossing the boundary under the same key cannot mint a second registration.

## Known gaps

These are contract mismatches, not bugs. Each is a place the vendor and the neutral port do not line up.

1. **The webhook is not wired.** The vendor pushes fiscalization status to a `statusUrl` with an
   `X-Signature` (`hash_hmac('sha256', rawBody, webhookSecret)`) header. The host's inbound ingress keys on a
   **closed** `CanonicalInboundEvent.domain` union with no fiscalization member, routes to a `JobType` with no
   fiscalization entry, and has no worker handler or reconcile job to nudge. Registering a decoder without a
   translator would authenticate every delivery and then dead-letter it. The synchronous status read covers the
   same ground; wiring the webhook needs core surface that belongs to a separate change.
2. **`FiscalLocateResult` cannot say "found, not registered yet".** Core reads any non-`null` locate answer as
   proof of a completed registration. When the vendor holds the document at `PENDING`/`READY`/`ERROR`, the
   adapter therefore returns `null` (with a warning naming the real status) so the record stays in doubt for an
   operator, rather than terminalising it on a registration that has not happened.
3. **`locateByQuery` needs the idempotency key.** The vendor publishes no search by order id, merchant document
   id or date range - its only document read is keyed by path token. `criteria.orderId`, `documentReference`
   and the date range are unusable here.
4. **A terminal `ERROR` cannot be retried under the same key.** The vendor replays the key idempotently, so a
   re-attempt after the operator fixes the device returns the same failed document. A genuine retry needs a
   fresh registration key - an operator action.
5. **`FiscalRecipient` is dropped.** The vendor's receipt payload has no buyer email or phone field; it
   distributes the receipt itself through `documentUrl`.
6. **The neutral command carries no payment breakdown.** The vendor requires one, so the adapter declares a
   single payment for the full sale total under a configurable form. The amount is never configurable - the
   vendor rejects a document whose declared payment differs from the sale value (`errorCode: 87`).
7. **A total that differs from the line sum becomes a whole-receipt `REBATE` line.** The neutral command
   carries order-level discounts only inside `totalGross`. A rate-less rebate line is the only way to reconcile
   the two without inventing a taxed position; the device distributes it proportionally.
8. **Currency is passed through but the device may not honour it.** The vendor field is the *register's* ledger
   currency. A non-`PLN` command is warn-logged rather than silently normalised.
9. **The sandbox has no fiscal device.** `GET /printers/{any}/status` returns a constant `INACTIVE` stub, so
   the connection tester reports device state as informational text on a **successful** result and never as a
   failure.

## Contract drift observed against the published spec

The vendor states the contract is not frozen, so every response is parsed tolerantly - unknown fields are
ignored and missing optionals degrade rather than throw. Confirmed drifts: `X-Api-Version` and
`X-Integration-Id` are documented as mandatory but are **not** enforced on GETs, and `errorCode: 92` is
returned for a missing document although only `100` was documented for that condition. **The documented
error-code list is not exhaustive** - no code here switches on it as a closed set.

## Tests

```bash
pnpm --filter @openlinker/integrations-eparagony test
```

All specs mock the transport. **Nothing in this package ever calls the live sandbox.**
