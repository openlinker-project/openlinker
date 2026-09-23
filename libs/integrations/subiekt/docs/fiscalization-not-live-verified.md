# Fiscalization capability — build status (#3192-fiscalization)

## What's done and verified

- `libs/integrations/subiekt/src/bridge/subiekt-bridge-fiscalization.types.ts` — the wire contract.
- `libs/integrations/subiekt/src/domain/types/subiekt-fiscalization-connection-config.types.ts` — the `drukarkaFiskalnaId`/`stanowiskoKasoweId` config shape (separate file from the shared `subiekt-connection-config.types.ts` deliberately, to avoid colliding with parallel worktree forks touching that file — fold it in at integration time).
- `libs/integrations/subiekt/src/infrastructure/adapters/subiekt-fiscalization.adapter.ts` — `FiscalizationPort` implementation, own small fetch-based transport (does not reuse the invoicing capability's `SubiektBridgeHttpClient`).
- `libs/integrations/subiekt/src/infrastructure/adapters/__tests__/subiekt-fiscalization.adapter.spec.ts` — 6 passing unit tests (registered / rejected / unknown-status / network failure / 401 / unsafe URL).
- `pnpm --filter @openlinker/integrations-subiekt type-check` — clean.
- `pnpm --filter @openlinker/integrations-subiekt test` — 243/243 passing (whole package, including the 6 new tests).
- `pnpm --filter @openlinker/integrations-subiekt lint` — clean (only a pre-existing unrelated warning remains).

## What's NOT done, and why

**This fork's worktree isolation refused every `powershell.exe` invocation outright** — not just git operations, the sandbox's exact message was:

> This agent is isolated in the worktree ..., but this command runs powershell in a plain command; what it reads or is handed as shell text cannot be shown not to run git. Refusing to run it.

This happened for `powershell.exe -Command "echo hello"` too, i.e. it is a blanket block on the interpreter itself, not a command-content filter. As a result, this fork had **zero access to the Windows machine** hosting the Subiekt bridge — no file writes, no `dotnet build`, no SQL queries, no live HTTP calls.

Consequently:

1. **`FiscalizationEndpoints.cs` was NOT copied onto the Windows bridge, NOT compiled, NOT run.** A ready-to-paste version is at `FiscalizationEndpoints.cs.ready` in this same folder — copy its body into `C:\Users\42zer\gtspike\bridge\FiscalizationEndpoints.cs` (the pre-existing stub), build, and reconcile against the TS types above.
2. **The `dok_StatusFiskalny` enum is unconfirmed.** Earlier in this session (before the worktree split) we found `SuDokument_StatusFiskalny.htm` describes only that the attribute exists ("Status fiskalizacji") with no enumerated values on that page. The `.cs.ready` file's `MapFiscalStatus` is a deliberate placeholder that reports `"unknown"` for everything until someone with live DB access reads a real `dok_StatusFiskalny` value off a document that went through `Drukuj(True)` successfully.
3. **No physical fiscal printer was confirmed configured** (`uf_Konfiguracja` table contents were never read this session). If the sandbox demo machine has no device configured, `RejestrujNaUF=True` + `Drukuj(True)` is genuinely untested territory — the `.cs.ready` file uses a **30s** `Sfera.Run` timeout (shorter than the other endpoints' 90-120s) specifically so a nonexistent device fails fast and recycles the worker rather than potentially hanging, but this number is a guess, not a measurement.
4. **No E2E run happened.** The adapter and its tests are internally consistent and the bridge file is written against the exact same contract, but nothing has proven the two sides actually agree on the wire — the invoicing capability's own history (`subiekt-bridge.types.ts`'s header comment) shows this kind of mismatch is a real, likely risk ("previous shapes were rejected by the bridge with HTTP 400 after a live wire-test proved [it] wrong").

## What to do next (whoever has Windows access)

1. Copy `FiscalizationEndpoints.cs.ready`'s body into the Windows bridge, build.
2. Check `SELECT * FROM uf_Konfiguracja` — if empty, this capability cannot be tested until an operator (or the eparagony-style sandbox device, if one exists on this box) provides a `uko_Id`.
3. Issue one `POST /api/fiscalize` by hand (curl/Postman) with a real `drukarkaFiskalnaId`, and read `dok_StatusFiskalny` on the resulting row — this single data point unblocks fixing `MapFiscalStatus` for real.
4. Re-run the TS adapter's tests against the real bridge (swap the fake-fetch tests for one live smoke call), and only then consider this capability production-ready.
5. Fold `SubiektFiscalizationConnectionConfig` into the shared `SubiektConnectionConfig`, wire the config-shape validator, and add `Fiscalization` to `subiektAdapterManifest.supportedCapabilities` in `subiekt-plugin.ts`.
6. **Route the adapter through the shared connection-bound transport before the capability is re-advertised.** `subiekt-fiscalization.adapter.ts` carries its own small fetch-based transport rather than reusing `SubiektBridgeHttpClient` (see "What's done" above), which means it bypasses the per-connection outbound limiter every other Subiekt call site goes through — including the `maxConcurrent` ceiling an operator sets on the connection. That is tolerable only while the capability is withheld from the manifest. Treat it as a **prerequisite of step 5**, not as something to rediscover after `Fiscalization` is live and a fiscal printer is being driven past the operator's own rate limit.
