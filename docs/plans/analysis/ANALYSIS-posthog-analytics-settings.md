# Pre-implement analysis — implementation-plan-posthog-analytics-settings.md (#1685)

## Verdict: READY

One Warning-level gap found (a test file the plan omitted from its file list); no Critical findings. Safe to proceed to implementation, folding the gap into step 6.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `libs/core/src/analytics/**` (new bounded context) | **NEW (confirmed absent)** | `ls libs/core/src/analytics` → no such directory |
| `apps/api/src/analytics/**` (new admin API module) | **NEW (confirmed absent)** | `ls apps/api/src/analytics` → no such directory |
| `POSTHOG_SETTINGS_REPOSITORY_TOKEN` / `POSTHOG_SETTINGS_SERVICE_TOKEN` / `POSTHOG_ENV_CONFIG_PORT_TOKEN` | **NEW (confirmed absent)** | `grep -rn` across `libs/` + `apps/` → no hits |
| `POSTHOG_API_KEY_CREDENTIALS_REF` | **NEW (confirmed absent)** | same grep, no hits |
| `posthog_settings` table | **NEW (confirmed absent)** | no migration references it |
| `IPosthogEnvConfigPort` / `IPosthogSettingsService` | **NEW (confirmed absent)** | no hits anywhere in the tree |
| `MailerModule`/`MailerSettingsService` pattern being mirrored | **EXISTS → reuse (template)** | `libs/core/src/mailer/**`, `apps/api/src/mailer/**` read in full during planning; plan mirrors it file-for-file |
| `ICredentialsService` (`@openlinker/core/integrations`) | **EXISTS → reuse** | `libs/core/src/integrations/application/interfaces/credentials.service.interface.ts`; already consumed the same way by `MailerModule` |
| `PosthogConfigService` (env reader) | **EXISTS → extend** | `apps/api/src/system/posthog-config.service.ts` — plan adds an `implements IPosthogEnvConfigPort` clause, no behavior change |
| `shared/ui/select.tsx`, checkbox pattern, `Alert`, `Dialog`, `FormField` (FE primitives) | **EXISTS → reuse** | confirmed present in `apps/web/src/shared/ui/` during planning; no new primitive needed |

No reuse collisions. No plan artifact silently reinvents something that already exists.

## Backward-compatibility findings

| Surface | Check | Severity | Note |
|---|---|---|---|
| `ISystemService.getConfig()` signature (`sync → Promise<...>`) | Only consumer is `SystemController`; only implementation is `SystemService` | **Warning** | Low blast radius (1 consumer, 1 implementation) but touches 5 files. **Gap found**: the plan's step 6 lists `system.service.spec.ts` for rewrite but omits **`apps/api/src/system/system.controller.spec.ts`**, which also calls `systemService.getConfig.mockReturnValue(...)` (sync) and asserts `controller.getConfig()` without `await` in both its test cases. This file must also be updated (`mockResolvedValue` + `await`) or it will fail to compile/pass once the controller method becomes `async`. Added to the implementation step list below — not a plan defect requiring a rewrite, just an omitted file.
| `SystemConfigDto` / `PosthogDemoIntegrationDto` field additions (`autocapture`, `sessionRecording`) | Additive optional-on-response fields | **None** | Purely additive; FE `PosthogConfig` type has no `zod`/strict validation (confirmed no `z.object` schema wraps it), so old FE builds reading a new-shaped response are unaffected, and the plan already updates the one FE consumer. |
| `libs/core/src/analytics` cross-context import of `@openlinker/core/integrations`'s `CREDENTIALS_SERVICE_TOKEN` | Checked against `scripts/check-cross-context-imports.mjs` | **None** | Identical import shape to `MailerModule`'s existing, passing usage — not a new pattern the invariant script would need an allow-list entry for. |
| `check-service-interfaces.mjs` (services must `implements I*Service` or `*Port`) | `PosthogSettingsService implements IPosthogSettingsService` with a co-located `.interface.ts` | **None** | Matches the required shape exactly (same as `MailerSettingsService`). |
| ORM schema (`posthog_settings` new table) | New table, no existing schema touched | **Warning (routine)** | Requires a migration per `docs/migrations.md` — already step 5 in the plan. Not a blocker, just confirming the routine requirement applies. |

No Critical findings — nothing in the plan removes/retypes an existing barrel export, port signature, DTO field, or Symbol token.

## Open questions

Both already surfaced by the plan itself and not gating:
1. `sessionRecording` default value on the env-fallback path (`true`, to preserve today's implicit-always-on behavior) vs. the DB row's own pre-save default (`false`) — a product decision, not a technical blocker; plan's proposed asymmetric default is reasonable and consistent with "don't silently change behavior for existing env-only deployments."
2. None remaining on integration-test scope — resolved during planning (Mailer has no int-spec, so none is added here either, for consistency).

## Action for implementation

Fold this gate's one finding into the plan's step 6: also rewrite `apps/api/src/system/system.controller.spec.ts`'s two test cases to `mockResolvedValue` + `await controller.getConfig()`.
