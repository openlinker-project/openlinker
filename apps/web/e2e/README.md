# apps/web/e2e — documentation-capture scripts

These `.mjs` files are **not automated tests**. They are manual, Playwright-driven
screenshot-capture scripts used to produce the images embedded in the integration
docs (`libs/integrations/<pkg>/docs/`). They contain no assertions and are **not
wired to any test runner** — `pnpm test` does not run them, and CI does not
execute them.

Run one directly with Node against a locally running OpenLinker web app + API:

```bash
node apps/web/e2e/woocommerce-walkthrough.mjs
```

Each script drives the real UI, so you need the web app (default
`http://localhost:4173`) and the API reachable, plus whatever integration-specific
state the script captures (a configured connection, an order id, etc.). Missing
required env vars either exit early with a message or produce error/404 shots.

## Shared conventions

- `WEB_BASE` — web app base URL (default `http://localhost:4173`).
- `OL_ADMIN_USERNAME` / `OL_ADMIN_PASSWORD` — admin login (default `admin` / `admin`).
- Some scripts default connection ids / order ids / bridge URLs to **author-local
  values** (marked with an "author-local" comment). Override them via env for your
  own environment, otherwise the capture will hit a 404 or the wrong record.

## Per-script env

| Script | Purpose | Notable env |
|---|---|---|
| `woocommerce-walkthrough.mjs` | WooCommerce master-shop walkthrough | `WC_SITE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET`, `WC_CONN_NAME`, `API_BASE` |
| `erli-walkthrough.mjs` | Erli connection + offer flow | `ERLI_CONNECTION_ID` (author-local default) |
| `erli-proofs.mjs` | Erli order / stock proofs | `ERLI_ORDER_ID` (author-local default) |
| `erli-panel.mjs` | Erli seller-panel captures | `ERLI_PANEL_BASE`, `ERLI_PANEL_USER`, `ERLI_PANEL_PASS`, `HEADED` |
| `subiekt-walkthrough.mjs` | Subiekt connection wizard | `SUBIEKT_BRIDGE_URL` (author-local default), `SUBIEKT_BRIDGE_TOKEN`, `SUBIEKT_CONN_NAME` |
| `subiekt-invoice.mjs` | Subiekt invoice issuance | `ORDER_B2B_ID`, `ORDER_B2C_ID`, `SUBIEKT_CONN_NAME` |
| `subiekt-proofs.mjs` | Subiekt idempotency / auto-issue proofs | `ORDER_AUTO_ID`, `ORDER_B2B_ID` |
| `ksef-payment-config.mjs` | KSeF payment-config form | `KSEF_CONN_ID`, `WEB_USER`, `WEB_PASSWORD` |
| `infakt-connection.mjs` | inFakt connection setup | `INFAKT_BASE_URL`, `INFAKT_SANDBOX_API_KEY`, `INFAKT_CONN_NAME` |
| `infakt-invoice.mjs` | inFakt invoice + clearance | `INFAKT_CONNECTION_ID`, `ORDER_ID`, `CLEARANCE_POLL_MS` |
| `annotate.mjs` | Shared image-annotation helper | (imported by other scripts) |
