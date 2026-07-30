# Pre-implement gate — #1949 MCP reconnect hint on the capabilities panel

- **Gated**: 2026-07-30
- **Plan**: `docs/plans/implementation-plan-1949-mcp-reconnect-hint-on-connections.md`
- **Issue**: #1949

## Verdict: `READY` — two Warnings to fold in first

No Critical contract breaks. The plan's load-bearing assumption (the capability gate) is confirmed against the live type. Two Warnings are cheap to address and one of them makes this PR the first consumer of a guard that was never installed.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `Connection.supportedCapabilities` (the gate reads it) | **EXISTS → reuse** | `features/connections/api/connections.types.ts:82` (`supportedCapabilities: string[]`). The plan's gate is viable exactly as written |
| `features/mcp-tokens/lib/` | **NEW** | feature has only `api/`, `components/`, `hooks/`, `index.ts`. `lib` is a canonical subdirectory, so the location is legal |
| `MCP_TOOL_AVAILABILITY_NOTE` / `MCP_CONNECTION_CHANGE_HINT` / `MCP_TOOL_CAPABILITIES` | **NEW** | no occurrence anywhere in `apps/web/src` |
| `ConnectionCapabilitiesPanel.test.tsx` | **EXISTS → extend** | already present; plan's step 5 extends rather than creates |
| `Alert` in the capabilities panel | **EXISTS → reuse** | already imported (`:19`) and used at `:98` (`error`) and `:153` (`warning`) |
| `useMcpTokensQuery` on the barrel | EXISTS — **but plan correctly declines to use it** | `features/mcp-tokens/index.ts`; see Deviation 1 in the plan (admin-only endpoint) |

**The plan's central correction holds.** `/mcp/tokens` is `@Roles('admin')` on every route while the connection page gates on `connections:write`, so the issue's proposed `tokens.length > 0` gate would 403 for the operators who actually toggle capabilities. Gating on `supportedCapabilities` is confirmed viable and needs no request.

## Backward-compatibility findings

No **Critical** items: nothing removed or renamed on a barrel, no port signature, no DTO, no Symbol token, no ORM entity, no migration.

| Surface | Severity | Finding |
|---|---|---|
| ESLint `no-restricted-imports` | **Warning** | **`mcp-tokens` appears nowhere in `.eslintrc.js`.** The feature has a public barrel (shipped with #1486) but was never added to either `no-restricted-imports` pattern group, so the cross-feature deep-import ban does not cover it. `frontend-architecture.md` § "Adding a new public feature surface" step 2 requires the slug in **both** groups for every canonical subdirectory. This PR becomes the **first cross-feature consumer** of that barrel, so it is the moment the missing guard starts to matter: nothing currently stops a later `import … from '../../mcp-tokens/lib/tool-staleness-copy'`. **Fix: add the `mcp-tokens` slug to both pattern groups** (`api`, `hooks`, `components`, `lib`, `types`) in the same PR |
| BE→FE constant duplication | **Warning** | `MCP_TOOL_CAPABILITIES` duplicates `McpToolCapabilityValues` (`apps/api/src/mcp/tools/tool-definition.types.ts:37`). `apps/web` cannot import from `apps/api`, so *some* duplication is forced — but there is an established precedent for guarding exactly this: `scripts/check-permission-mirror.mjs` ("lint-time invariant for the hand-maintained frontend mirror of the backend's [permissions]"), wired into `check:invariants`. Today the two lists agree; **#1488 and #1489 both add MCP tools**, and a write tool backed by a different capability would silently desync the hint's gate from reality. Two options: (a) a source comment naming the backend constant as the source of truth — cheap, no guard; (b) a `check-mcp-tool-capability-mirror.mjs` following the permission-mirror shape — correct, but a lint script for a one-line hint is arguably disproportionate. **Recommend (a) now, with the drift risk recorded**, since the failure mode is a *missing hint*, not incorrect behaviour |
| `check-design-tokens` | None | plan touches no CSS |
| `check-cross-context-imports` | None | that walker covers `libs/core`, `libs/integrations`, `apps/{api,worker}` — not `apps/web` |

## Open questions

1. **Three Alerts in one panel.** The capabilities panel already renders `tone="error"` (update failure) and `tone="warning"` (no capabilities enabled). Adding a third, always-on `tone="info"` risks alert fatigue on a single surface — the style guide's "keep the shell informational, not editorial" pressure. Not a blocker, but the visual weight is a real design question the plan does not address. Worth resolving in review before implementation.
2. **The plan's own open question stands** — whether the hint should also appear on the disable confirm dialog. The gate has nothing to add: it is a judgement about operator attention, not a fact about the repo.

## Suggested step additions

- **Step 0** (new): add `mcp-tokens` to both `no-restricted-imports` pattern groups in `.eslintrc.js`.
- **Step 1** (amend): the copy module's header must name `McpToolCapabilityValues` (`apps/api/src/mcp/tools/tool-definition.types.ts`) as the source of truth for `MCP_TOOL_CAPABILITIES`, and state that #1488/#1489 will add tools that must be reflected here.
