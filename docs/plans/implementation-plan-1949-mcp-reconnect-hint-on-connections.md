# Implementation plan — #1949 surface the MCP reconnect hint where capabilities change

- **Issue**: #1949 (follow-up to #1932 / PR #1948)
- **Branch**: `1949-mcp-reconnect-hint-on-connections`
- **Layer**: Frontend only

## 1. Understand the task

#1932 put the tool-staleness note on `/settings/mcp-tokens`. An operator who *causes* the staleness is not on that page — so the note is only found by someone who already suspects the problem, which is the state it exists to prevent. This issue moves the guidance to where the triggering action happens.

The issue left four questions open (placement, gate, copy, duplication). Research settles all four, and **two of the answers contradict the issue's own scope sketch** — flagged explicitly below rather than silently adopted.

### Non-goals

Unchanged from #1932: no sessions, no `WebStandardStreamableHTTPServerTransport`, no `sendToolListChanged()`. No backend change of any kind. This is about *where* existing guidance surfaces.

## 2. Research

### What actually gates MCP tool registration

`McpToolRegistryService` registers a tool iff `listCapabilityAdapters({ capability, lazy: true })` finds a supporting-and-enabled connection. That call (`integrations.service.ts:143`) does **two** filters:

1. `status: 'active'` — so disabling a connection drops all its tools;
2. intersects the adapter manifest with the connection's **`enabledCapabilities`** — so toggling one capability off de-registers exactly the tools it backs.

Both are real triggers. The second is the *precise* one, and it is not among the three placements the issue proposed.

| Surface | Mutates | Is it a trigger? |
|---|---|---|
| `ConnectionCapabilitiesPanel` | `enabledCapabilities` via `useUpdateConnectionMutation` | **Yes — directly.** Toggling `ProductMaster` off de-registers `search_catalog` / `get_product` |
| `EnableConnectionButton` / disable action | `status` | Yes, coarsely — takes every capability with it |

### The MCP-tool capability set

`McpToolCapabilityValues = ['ProductMaster', 'InventoryMaster', 'OrderSource']` (`tool-definition.types.ts:37`). A connection supporting none of these has no MCP tools, so a reconnect hint there would be noise.

### Existing seams

| Fact | Evidence |
|---|---|
| `useMcpTokensQuery` is on the public barrel | `features/mcp-tokens/index.ts` |
| Cross-feature barrel imports are the sanctioned shape | `frontend-architecture.md` § Feature Public Surface, `posthog-settings` → `demo` precedent |
| `ConnectionCapabilitiesPanel` already imports `Alert` | its import block |
| `lib/` is a canonical feature subdirectory | § Feature Public Surface (`api`, `hooks`, `components`, `lib`, `types`) |

## 3. Design — and two deviations from the issue

### Deviation 1: **do not** gate on `useMcpTokensQuery`

The issue proposes `tokens.length > 0`. **This does not work.** Every route on `McpTokensController` is `@Roles('admin')` (`mcp-tokens.controller.ts:55/88/99`), while the connection detail page gates on `connections:write`. A non-admin **operator** — exactly the person toggling capabilities — would get a 403 on every render, and the hint would silently never appear for the primary audience, plus a failed request per page load.

**Gate on the capability set instead**: render the hint only when the connection's `supportedCapabilities` intersects `['ProductMaster', 'InventoryMaster', 'OrderSource']`. This is *better* than the proposed gate on three counts — it needs no request, works for every role, and is more precise (it asks "could this connection back an MCP tool?" rather than "has anyone ever made a token?").

**Why `supportedCapabilities` and not `enabledCapabilities`** (this looks like a bug and is not — say so in the code too): tool registration reads `enabledCapabilities`, so gating the *hint* on it would make the hint **disappear the instant an operator toggles a capability off** — exactly the moment it is needed, since that toggle is what just staled the client's tool list. `supportedCapabilities` is stable across the toggle and answers the question the hint depends on: could this connection ever back an MCP tool?

It is also **coarser in one direction** and that is accepted: it does not know whether an agent is currently connected. Stateless serving means OL cannot know that (ADR-033), so no gate can.

### Deviation 2: placement is the capabilities panel, not the three options listed

The issue offered actions panel / list row / confirm dialog. The capabilities panel beats all three because it is the surface that mutates the thing the gate actually reads.

The **disable** path is deliberately left alone: `EnableConnectionButton`'s header records that disable already opens a confirm dialog "because it stops every job on a live integration". Next to that, "your MCP client needs a reconnect" is noise, and appending it would violate the issue's own duplication concern for marginal value.

### Duplication — one owner, two strings

Two copies of this guidance now exist (settings page + connections). To keep them from drifting, both read from **one module owned by the MCP feature**: `features/mcp-tokens/lib/tool-staleness-copy.ts`, exported from that barrel. The strings differ deliberately (the panel has room for two sentences; the connection hint must be one line), so the module exports two named constants rather than one shared string — the point is a single place to edit, not identical wording.

Direction is `connections` → `mcp-tokens` barrel. Correct: MCP domain copy belongs to the MCP feature; the reverse would put MCP knowledge in `connections`.

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 0 | `.eslintrc.js` | Add the `mcp-tokens` slug to **both** `no-restricted-imports` pattern groups (the `features/**` rule and the `plugins/**` rule) for every canonical subdirectory (`api`, `hooks`, `components`, `lib`, `types`) | Closes a pre-existing gap from #1486 — the barrel shipped without step 2 of `frontend-architecture.md` § "Adding a new public feature surface". This PR is its first cross-feature consumer, so the guard must exist before the deep-import target does |
| 1a | `features/mcp-tokens/lib/tool-staleness-copy.ts` (new) | `MCP_TOOL_AVAILABILITY_NOTE` (2 sentences) + `MCP_CONNECTION_CHANGE_HINT` (1 line) | Strings only. Header cites #1932/#1949 and says why the two wordings differ; no JSX |
| 1b | `features/mcp-tokens/lib/mcp-tool-capabilities.ts` (new) | `MCP_TOOL_CAPABILITIES` as an `as const` tuple + derived union type | **Separate file**: the strings change when wording changes, this changes when a tool is added — different reasons to change, and nobody looks for a capability set in a file named `…-copy.ts`. Header names `McpToolCapabilityValues` (`apps/api/src/mcp/tools/tool-definition.types.ts:37`) as the source of truth and notes #1488/#1489 will extend it |
| 2 | `features/mcp-tokens/index.ts` | Export all three symbols | Barrel is the only cross-feature surface |
| 3 | `features/mcp-tokens/components/mcp-tokens-panel.tsx` | Read `MCP_TOOL_AVAILABILITY_NOTE` instead of the inline string | Existing test still passes unchanged — proves the copy is identical |
| 4 | `features/connections/components/ConnectionCapabilitiesPanel.tsx` | Render `<Alert tone="info">{MCP_CONNECTION_CHANGE_HINT}</Alert>` when `supportedCapabilities` intersects `MCP_TOOL_CAPABILITIES`, with an inline comment recording the `supported`-not-`enabled` reasoning (§3) | No new import beyond the barrel; `Alert` already imported. A third `Alert` is acceptable here: the other two are conditional (`updateMutation.error`, `enabled.size === 0`), so in the steady state this is the only one on the panel |
| 5 | `ConnectionCapabilitiesPanel.test.tsx` | Two cases: hint renders for an MCP-backing connection; hint absent for a connection with none | `pnpm --filter @openlinker/web test` green |

**No CSS step** — reuses `Alert`, so `index.css` is untouched and `check-design-tokens` sees nothing new.

## 5. Validation

- **Architecture**: FE-only. `features` → `features` via public barrel (sanctioned); `features` → `shared` for `Alert`. No `app`/`pages` import added, no new dependency direction.
- **State**: no new state, no new query. The gate reads a field already on the `Connection` the panel receives as a prop.
- **A11y**: reuses `Alert`; same `role="status"` posture as the shipped #1932 note and the `ksef-setup-form` precedent.
- **Security**: no secrets, no auth logic. Notably this design *avoids* an admin-only request on an operator-visible page.
- **Testing**: component tests only. Nothing crosses HTTP, so no int-spec.

## Pre-implement gate

**Will run it.** Unlike #1932 this adds a new file, a new barrel export, and a cross-feature edge — exactly the reuse/contract surface the gate checks. Cheap to run, and the barrel export is a contract addition.

## Open question for the reviewer

Whether the hint should *also* appear on the disable confirm dialog. This plan says no (noise next to "stops every job"), but that is a judgement call about operator attention, not a fact — easy to add later if the one placement proves insufficient.
