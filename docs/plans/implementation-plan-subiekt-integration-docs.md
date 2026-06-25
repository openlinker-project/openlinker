# Implementation Plan — Subiekt integration E2E verification + tutorial guide (seeds #760)

**Status:** local plan (scratchpad), mirrors the Erli #1209 rework template
**Docs issue:** #760 — "formal Subiekt integration page with version support matrix"
**Docs branch (final PR):** `760-subiekt-integration-docs` off `origin/main`
**Date:** 2026-06-25

---

## Goal

Produce a tutorial-style, screenshot-driven Subiekt integration guide under
`docs/integrations/subiekt/` (Erli-parity: `setup-guide.md` + `runbook.md`),
proven by a **real full-chain E2E**: PrestaShop order → OpenLinker ingestion →
invoice trigger → Subiekt adapter (#753) → real **Subiekt Bridge** (Windows,
`openlinker-subiekt` repo) → faktura/paragon issued in **Subiekt nexo**.
Automate the OL side with Playwright (`apps/web/e2e/subiekt-*.mjs`), capture
both OL-browser and Windows-native screenshots, and seed #760. User only
validates the result.

Net-new vs the prior manual run (bridge repo `docs/SUBIEKT_OPENLINKER_INTEGRATION.md`,
2026-06-24): Playwright automation, the two missing Windows screenshots, a
**real** PS ingestion (not the seeded snapshot), guided-wizard setup (#1199),
and the canonical English OL-side guide.

---

## Decisions (from grill 2026-06-25)

| # | Decision |
|---|---|
| 1 | Full-stack E2E verify + tutorial (not bridge-only). |
| 2 | Capture worktree off `origin/main` merges `invoicing/backend` + `invoicing/jobs` + `invoicing/frontend` (#1211) + `1199-subiekt-wizard`. FE/wizard win `apps/web` conflicts. #753 adapter already on main. KSeF reconcile (#1121) out of scope. |
| 3 | Real bridge (`openlinker-subiekt`, mature hexagonal .NET8). Verified contract: HTTPS + `Authorization: Bearer <Auth__ApiKey>`, `bridgeBaseUrl` w/o `/api`, adapter key `subiekt.invoicing.v1`. |
| 4 | WSL = OL stack + Playwright + docs + PR. Windows (Claude for Desktop) = bridge :5005 + Subiekt + SQL. Link `https://<windows-host>:5005`. No tunnel. |
| 5 | Real PrestaShop dev-stack order (full chain). Seeded snapshot = documented fallback only. |
| 6 | Guided wizard (#1199) primary; advanced-mode fallback aside. |
| 7 | English; `docs/integrations/subiekt/setup-guide.md` + `runbook.md`; version matrix in runbook. Assets `docs/assets/subiekt/NN-name.png`. |
| 8 | Both FV (NIP) + PA (B2C). KSeF = demo-only. Fiscal-printer caveat for PA in runbook. |
| 9 | Claude for Desktop captures Windows screens hands-off via a handoff script; WSL Claude wires + blurs (ffmpeg). |
| 10 | Throwaway capture worktree (code discarded). Docs-only PR off main, `Closes #760`. Code via own PRs. |
| 11 | Signed commits (`-s`), English PR body, single PR (no separate plan PR). |
| 12 | Capture as many useful screenshots as possible at every step. |

---

## Phase 0 — Windows handoff prep (Claude for Desktop)

Author a `WINDOWS_HANDOFF` runbook for the Windows agent (build on the bridge
repo's `docs/WINDOWS_HANDOFF.md` + `QUICK_START.md`/`docs/DEPLOYMENT.md`):

1. Clone/pull `openlinker-subiekt`; set `appsettings.json`: `Sfera.BinariesDir/ConfigDir/TempDir`
   from `%LOCALAPPDATA%\InsERT\Deployments\Nexo\<deployment>\…`, SQL server/db, Nexo operator creds.
2. TLS: dev self-signed (`dotnet dev-certs https -ep dev-cert.pfx -p <pwd>`) → `Tls:CertPath` + `Tls__CertPassword`.
3. `Auth__ApiKey=<token>` (env); record token (becomes OL `bridgeToken`).
4. Firewall inbound on 5005 (Private/Domain). `ASPNETCORE_URLS=https://0.0.0.0:5005`.
5. `dotnet run -c Release`; confirm `Now listening on https://…` + `Sfera: zalogowano`.
6. Report back: the reachable host (`https://<windows-host>:5005`) + the Bearer token.

**Windows shot list (capture all that apply):** bridge console (listening + Sfera login);
`/health` JSON (`sferaSession: valid`); Subiekt nexo dokumenty-sprzedaży list; the issued
**FS …/CENTRALA** faktura open (lines + VAT); the **PA …/CENTRALA** paragon; the created
kontrahent (NIP); KSeF/e-faktura status view if present.

## Phase 1 — Capture worktree assembly (WSL)

1. `git worktree add /tmp/.../subiekt-capture origin/main`.
2. Merge in order, FE/wizard authoritative on conflicts:
   `invoicing/backend` → `invoicing/jobs` → `invoicing/frontend` (#1211) → `1199-subiekt-wizard`.
3. `pnpm install`; `pnpm build` (or scoped); resolve any TS drift from the merge.
4. Sanity: `pnpm --filter @openlinker/api type-check`, web build.

## Phase 2 — Stack up + connection + real PS order (WSL)

1. `pnpm dev:stack:up` (Postgres/Redis/MySQL/PrestaShop); `pnpm dev:stack:seed-prestashop`.
2. Start `api` + `worker` + `web` (preview on :4173 for Playwright, per Erli).
3. Get the Windows bridge host+token (Phase 0). Verify WSL→bridge: `curl -k https://<host>:5005/health`.
4. Add **Subiekt** connection via **guided wizard** (#1199): bridgeBaseUrl + Bearer token +
   Invoicing capability + trigger model `manual`. Connection-test → `/health` OK.
5. Add **PrestaShop** connection (dev stack). Place/seed a real PS order with a B2B buyer
   (valid NIP, e.g. `9521471103`) and a second B2C order (no NIP). Ingest into OL.

## Phase 3 — Playwright capture + Windows capture + blur

1. Write `apps/web/e2e/subiekt-walkthrough.mjs` (wizard setup → connection-test OK),
   `subiekt-invoice.mjs` (order panel → Issue FV + PA → ISSUED + number + KSeF badge → `/invoices`),
   `subiekt-proofs.mjs` (auto-trigger on order-paid + idempotency: re-issue → same doc).
   Mirror Erli scripts (admin/admin login, `fullPage`, `docs/assets/subiekt/`).
2. Run scripts → capture all OL-side shots (numbered).
3. Trigger auto-issue + verify idempotency via worker.
4. Windows agent runs Phase 0 shot list → hand PNGs to WSL.
5. Blur sensitive regions (ffmpeg boxblur recipe from Erli plan): real NIP/company, SQL
   strings, Nexo password, license/deployment ids.
6. Place all PNGs in `docs/assets/subiekt/`.

## Phase 4 — Write docs (English, seeds #760)

1. `docs/integrations/subiekt/setup-guide.md` — tutorial:
   - What you get (Invoicing capability; FV/PA; optional KSeF status).
   - Prerequisites: Subiekt nexo PRO + Sfera on Windows; bridge running (link to
     `openlinker-subiekt` repo + its DEPLOYMENT/QUICK_START); a PrestaShop connection
     as order source; B2B needs valid buyer NIP else B2C paragon.
   - Run the bridge (summary + link). Guided-wizard connection setup (primary) +
     advanced-mode aside. Connection-test. Real PS order → Issue invoice (manual) +
     auto-trigger aside. Verify in `/invoices` + in Subiekt nexo (screenshots).
2. `docs/integrations/subiekt/runbook.md` — ops reference:
   - TLS + Bearer + firewall requirements; config/env keys table; adapter key.
   - **Version support matrix** (nexo PRO ✅ / nexo vanilla ⚠️ / GT ❌).
   - Trial/demo caveats (KSeF demo-only; paragon fiscal-printer note); idempotency keying;
     trigger models. Troubleshooting table (ported + expanded from bridge doc §H).
   - Wire-contract appendix (verified payloads for upsert / invoices / status).
3. Cross-links: ADR-026 invoicing domain; bridge repo; PrestaShop connecting guide.
4. Move this plan to `docs/plans/implementation-plan-subiekt-integration-docs.md` on the docs branch.

## Phase 5 — Docs PR

1. Fresh branch `760-subiekt-integration-docs` off `origin/main`.
2. Add: `docs/integrations/subiekt/*`, `docs/assets/subiekt/*`, `apps/web/e2e/subiekt-*.mjs`,
   the plan doc. **No invoicing code.**
3. `git status` confirm docs+assets+scripts only. Markdown sanity (links/images resolve;
   no leftover Polish/placeholders; secrets blurred).
4. Commit signed (`-s`), push, open PR `Closes #760` (English body).
5. `git worktree remove` the throwaway capture worktree.

---

## Open execution details (resolve live)

- Exact WSL→Windows bridge host at run time (mirrored-networking localhost vs gateway IP).
- Whether #1199 wizard merges cleanly atop #1211 or needs apps/web conflict resolution.
- Exact blur pixel regions once Windows shots exist.
- Whether dev-stack PrestaShop reliably ingests on the constrained PC; else seeded-snapshot fallback.
- Confirm OL adapter wire shape still matches current bridge (contract verified 2026-06-24; re-check at run).
