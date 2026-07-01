# inFakt Integration Setup Guide

OpenLinker integrates with **inFakt** (a Polish accounting SaaS) as a fiscal-document
provider: it issues invoices and reads back their KSeF clearance status through
inFakt's own, native KSeF submission.

inFakt is the second provider of the country-agnostic **Invoicing** domain
([ADR-026](../../architecture/adrs/026-country-agnostic-invoicing-domain.md)). Unlike
the `@openlinker/integrations-ksef` package, OL never opens a KSeF session or builds
FA(3) XML for inFakt-issued invoices — inFakt does that internally, on its own
timing. See [ADR-030](../../architecture/adrs/030-infakt-ksef-indirection.md) for the
full rationale behind that design.

---

## Capabilities

| Capability | Supported | Notes |
|---|---|---|
| `Invoicing` (`issueInvoice` / `getInvoice` / `upsertCustomer` / `getSupportedDocumentTypes`) | ✅ | Document types: `invoice`, `corrected`, `proforma`, `prepayment`. |
| `RegulatoryStatusReader` (`getClearanceStatus`) | ✅ | Reads `ksef_data.status` off the stored invoice. **Not** `RegulatoryTransmitter` — inFakt submits to KSeF itself; OL has no submit primitive to call. |
| `CorrectionIssuer` (`issueCorrection`) | ✅ | Issues a `corrective` invoice against `POST /invoices.json` with a before/after line-pair payload. |

- **adapterKey:** `infakt.accounting.v1`
- **platformType:** `infakt`
- **displayName:** `Infakt Accounting API v3`

---

## Prerequisites

1. An active [inFakt](https://www.infakt.pl/) account (or an inFakt **sandbox**
   account for testing — the same API shape, a different `baseUrl`).
2. **KSeF integration enabled** in your inFakt account settings, with auto-submit-on-issue
   turned on. This is what makes clearance happen without OL driving KSeF itself — see
   [ADR-030](../../architecture/adrs/030-infakt-ksef-indirection.md) for why OL doesn't
   (and can't) control this timing.
3. An **API key**, generated from your inFakt account settings.

![inFakt dashboard login](../../../libs/integrations/infakt/docs/assets/if1-infakt-dashboard-login.png)

![inFakt API key page](../../../libs/integrations/infakt/docs/assets/if2-infakt-api-key-page.png)

---

## 1. Creating the connection in OL

From **Connections → New connection**, pick **inFakt** from the platform picker.

![Platform picker](../../../libs/integrations/infakt/docs/assets/00-platform-picker.png)

The guided wizard (`/connections/new/infakt`) collects:

| Field | Required | Description |
|---|---|---|
| Connection name | ✅ | A label to identify this inFakt account in OpenLinker. |
| API key | ✅ | The credential from [Prerequisites](#prerequisites). Stored encrypted server-side; never echoed back to the browser after creation. |
| Base URL (optional) | ❌ | Advanced override for sandbox testing. Must use HTTPS. Leave blank to use inFakt's production API. |

![inFakt wizard, empty](../../../libs/integrations/infakt/docs/assets/01-infakt-wizard-empty.png)

![inFakt wizard, filled in](../../../libs/integrations/infakt/docs/assets/02-infakt-wizard-filled.png)

After submitting, the connection is created and a **Test connection** affordance
appears — use it to confirm the API key is valid before relying on the connection.

![Connection created](../../../libs/integrations/infakt/docs/assets/03-infakt-connection-created.png)

![Connection test passed](../../../libs/integrations/infakt/docs/assets/04-infakt-connection-test-ok.png)

![Connections list with inFakt](../../../libs/integrations/infakt/docs/assets/05-connections-list-with-infakt.png)

---

## 2. Webhook configuration

Webhooks are the low-latency path for learning that inFakt has finished submitting an
invoice to KSeF (the "webhook = trigger, poll = reconciliation backstop" pattern —
`getClearanceStatus()` remains the source of truth; the webhook only triggers an
immediate re-read).

**inFakt webhook subscriptions are configured entirely in the inFakt dashboard** — there
is no programmatic `WebhookProvisioningPort` for this adapter (unlike PrestaShop's
auto-provisioning). Set it up manually:

1. In your inFakt account, go to **Settings → Webhooks** (or the equivalent
   integrations/API section) and create a new subscription.
2. **URL**: `POST https://<your-ol-host>/webhooks/infakt/{connectionId}` — substitute
   the connection ID shown on the connection-detail page in OL.
3. **Events**: subscribe at minimum to `send_to_ksef_success` and `send_to_ksef_error`
   (every other event inFakt can send is accepted and silently ignored by OL).
4. inFakt sends a **verification ping** — a POST with `{"verification_code": "..."}` —
   to confirm the endpoint is live. OL's webhook decoder echoes the same code back
   automatically; the subscription activates once inFakt sees the matching echo.
5. **Secret**: OL and inFakt must share the same HMAC secret to verify
   `X-Infakt-Signature` on every delivery. In OL, go to the connection's detail page
   and use **Rotate webhook secret** to generate one (shown exactly once — copy it
   immediately). Paste that same value into inFakt's webhook subscription secret field.

![inFakt webhooks list](../../../libs/integrations/infakt/docs/assets/if3-infakt-webhooks-list.png)

![inFakt webhook subscription form](../../../libs/integrations/infakt/docs/assets/if4-infakt-webhook-form.png)

> **If inFakt does not let you set a custom secret** for the subscription (some
> providers only display an auto-generated one), copy inFakt's generated value and use
> it as the OL-side secret instead — there is currently no endpoint to set the OL
> webhook secret to an arbitrary caller-supplied value, only to rotate to a new
> randomly-generated one. This is a known gap; see
> [Troubleshooting](#troubleshooting) if signatures don't match after setup.

---

## 3. Verifying the integration

1. Trigger an invoice issuance from OL for a test order (**Order detail → Issue
   invoice**, connection set to your inFakt connection).

   ![Orders list](../../../libs/integrations/infakt/docs/assets/08-orders-list.png)

   ![Order detail, not yet issued](../../../libs/integrations/infakt/docs/assets/10-order-detail-not-issued.png)

2. Immediately after issuance, the invoice section shows `submitted` — inFakt has
   accepted the invoice and queued it for KSeF submission.

   ![Invoice issued, submitted](../../../libs/integrations/infakt/docs/assets/11-invoice-issued-submitted.png)

3. Within roughly a minute (sandbox: ~90s observed), inFakt's own KSeF submission
   completes. The webhook fires, OL re-reads the status, and the invoice section
   updates to `accepted` with a clearance reference chip.

   ![Invoice accepted / cleared](../../../libs/integrations/infakt/docs/assets/12-invoice-accepted-cleared.png)

4. Confirm the same invoice shows as KSeF-confirmed from inFakt's own side.

   ![inFakt invoice confirmed](../../../libs/integrations/infakt/docs/assets/if5-infakt-invoice-confirmed.png)

5. The full invoice detail page renders the regulatory region alongside the rest of
   the invoice.

   ![Invoice detail page](../../../libs/integrations/infakt/docs/assets/13-invoice-detail-page.png)

### Correcting an invoice

Use **Issue correction** on an already-issued invoice to file a `corrective` document.
Pick the line(s) to correct and the new quantity/price.

![Correction dialog, empty](../../../libs/integrations/infakt/docs/assets/14-correction-modal-empty.png)

![Correction dialog, filled in](../../../libs/integrations/infakt/docs/assets/15-correction-modal-filled.png)

![Correction issued](../../../libs/integrations/infakt/docs/assets/16-correction-issued.png)

![Invoices list, with correction linked to the original](../../../libs/integrations/infakt/docs/assets/17-invoices-list.png)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Connection test fails immediately | Wrong or revoked API key, or `baseUrl` pointed at the wrong environment | Re-check the API key in inFakt account settings; confirm `baseUrl` is blank (production) or the correct sandbox host. |
| Webhook deliveries return 401 | `X-Infakt-Signature` doesn't match — the OL and inFakt secrets are out of sync | Re-rotate the OL webhook secret and re-paste it into the inFakt subscription (or vice versa — see the note in [Webhook configuration](#2-webhook-configuration)). |
| Webhook subscription never activates | The verification-ping echo didn't reach inFakt (host unreachable, TLS issue, or the connection ID in the URL is wrong) | Confirm the URL path matches `POST /webhooks/infakt/{connectionId}` exactly and the host is publicly reachable from inFakt's servers. |
| Invoice stays `submitted` forever, never reaches `cleared`/`accepted` | KSeF auto-submit is disabled in inFakt's account settings (the [Prerequisites](#prerequisites) toggle), or KSeF itself rejected the document | Check inFakt's own invoice/KSeF status in its dashboard first — `ksef_data.status: error` there means inFakt attempted submission and KSeF rejected it (fix the underlying document data and re-issue); if KSeF auto-submit is off, `getClearanceStatus()` will keep returning `not-applicable` — turn the setting back on. |
| Rate limiting / `429` from inFakt | Sandbox and low-tier plans enforce API rate limits | Space out bulk issuance; inFakt's retry classifier (`InfaktRetryClassifierAdapter`) already treats `429` as retryable in the worker's job runner. |

---

## Related documentation

- [ADR-030](../../architecture/adrs/030-infakt-ksef-indirection.md) — why this adapter
  implements `RegulatoryStatusReader`, not `RegulatoryTransmitter`
- [ADR-026](../../architecture/adrs/026-country-agnostic-invoicing-domain.md) — the
  country-agnostic invoicing domain this provider plugs into
- [ADR-021](../../architecture/adrs/021-third-party-native-inbound-webhook-ingestion.md) —
  the inbound-webhook-decoder pattern `InfaktInboundWebhookDecoderAdapter` implements
- [`libs/integrations/infakt/README.md`](../../../libs/integrations/infakt/README.md) —
  package-level adapter reference (capabilities, credentials/config shape)
