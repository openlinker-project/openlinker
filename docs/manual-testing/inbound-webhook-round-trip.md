# Inbound webhook round-trip (manual + automated)

Verifies OpenLinker's **low-latency primary ingestion path** — a real inbound
webhook `POST /webhooks/:provider/:connectionId` — end to end. This complements
the golden path, which ingests orders via job-trigger / poll and never fires a
real webhook.

There are two layers:

1. **Automated** (CI-runnable): an `apps/e2e` spec fires a *self-signed* inbound
   webhook and asserts the receiver chain. It signs the request with the
   connection's own webhook secret, so the bytes are identical to a platform
   delivery — but OL is both sender and receiver.
2. **Manual / attended**: a real external platform (PrestaShop module, Erli,
   InPost, inFakt) delivers a webhook through a public tunnel to the running
   stack. CI cannot make a third-party platform fire, so this stays an attended
   check.

---

## 1. Automated spec

- **Spec**: `apps/e2e/tests/webhooks/inbound-webhook.spec.ts`
- **Project**: `webhooks` (depends on `setup`, `retries: 0`)
- **Provider covered**: PrestaShop (OL-HMAC). The same signing helper
  (`apps/e2e/src/support/webhooks.ts`) works for any OL-enveloped provider.

### What it asserts

| Step | Assertion |
|---|---|
| verify | A correctly-signed `order.created` webhook returns `202`. |
| record | A `webhook_deliveries` row appears (`GET /webhook-deliveries`) with `signatureValid: true`. |
| enqueue | The row reaches `status: job_enqueued` with a `downstreamJobId` of type `marketplace.order.sync`, and the job is visible on `GET /sync/jobs/:id`. |
| dedup | Re-POSTing the byte-identical request returns `202` again and creates **no** second row (Postgres dedup gate, #711). |
| reject | A request signed with the wrong secret returns `401` and records **no** delivery row. |

### How it signs

The OL-HMAC scheme the PrestaShop module uses, reproduced exactly by
`signWebhook()`:

```
timestamp = <epoch ms>                     ->  header X-OpenLinker-Timestamp
signature = "sha256=" + HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
                                           ->  header X-OpenLinker-Signature
```

`rawBody` is the OL webhook envelope (`WebhookRequestDto` shape) and is sent
verbatim — re-serializing would change the bytes and break the signature.

The per-connection webhook **secret** is obtained via
`POST /connections/:id/webhooks/secret/rotate` (revealed once). The spec rotates
it in `beforeAll`, so the plaintext is known to the signer.

### Run it

```bash
# against a running stack (defaults: web :8090, api :3000)
pnpm --filter @openlinker/e2e exec playwright test --project=webhooks
```

The spec **self-skips with an annotation** when there is no PrestaShop
connection on the stack or its secret cannot be rotated — it is a no-op on a
stack that isn't wired for webhooks, not a failure.

> Note: running the spec **rotates** the connection's webhook secret. If a real
> external PrestaShop module was provisioned against the old secret, re-install
> it (`POST /connections/:id/webhooks/install`, or the FE "Install webhooks"
> action) so live deliveries keep verifying.

---

## 2. Manual attended round-trip

Confirms a genuine third-party platform can reach the receiver through a public
URL and that OL verifies + records the delivery. Do this once per webhook-capable
integration after wiring changes.

Webhook-capable integrations and their auth scheme:

| Provider | Auth | Header(s) |
|---|---|---|
| PrestaShop | OL-HMAC | `X-OpenLinker-Timestamp`, `X-OpenLinker-Signature` |
| Erli | Bearer echo | `Authorization: Bearer <accessToken>` |
| InPost | InPost HMAC | `x-inpost-signature`, `x-inpost-timestamp` |
| inFakt | HMAC + handshake | provider-specific |

(The rest poll by design: Allegro, WooCommerce, DPD, KSeF, Subiekt.)

### Steps

1. **Expose the stack.** Start a public tunnel to the API origin (e.g.
   `cloudflared tunnel --url http://localhost:3000`). Note the public base URL.
2. **Provision the webhook on the platform.** For PrestaShop, use the
   auto-installer: `POST /connections/:id/webhooks/install` (or the FE "Install
   webhooks" button). It pushes the callback URL + secret to the module and
   fires a `test.ping`. For third-party platforms, register
   `<public-url>/webhooks/<provider>/<connectionId>` in the platform's webhook
   settings using that platform's secret/scheme.
3. **Trigger a real event** on the platform (e.g. create/update an order in the
   PrestaShop back office; change an order status on Erli).
4. **Confirm receipt** in OL:
   - `GET /webhook-deliveries?provider=<provider>&connectionId=<id>` — a fresh
     row with `signatureValid: true` and `status` of `published` /
     `job_enqueued` (or `received` for a `test.ping`).
   - For an order/stock/product event, confirm a `marketplace.*` /
     `master.*` sync job on `GET /sync/jobs`.
5. **Confirm downstream mutation** (optional, strongest signal): the synced
   order/inventory/product appears/updates in OL.

### Pass criteria

- The delivery is recorded with a valid signature.
- A non-`test.` event enqueues the expected downstream job.
- A replayed delivery is deduped (no duplicate row, no duplicate job).
