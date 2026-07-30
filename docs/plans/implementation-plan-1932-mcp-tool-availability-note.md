# Implementation plan — #1932 MCP tools/list staleness: operator-facing note

- **Issue**: #1932 (spun out of #1487 / PR #1931)
- **Branch**: `1932-mcp-tools-list-reconnect-note`
- **Layer**: Frontend only

## 1. Understand the task

OL serves MCP **statelessly** — `createMcpHandler` builds a fresh `McpServer` per request, which is what makes multi-replica deployment safe with no sticky routing (ADR-033). The consequence is that OL cannot send `notifications/tools/list_changed`: there is no long-lived session to push over.

The *server* is therefore always fresh. But MCP **clients cache the tool list**, and that cached copy goes stale. Observable symptom: an operator enables a `ProductMaster` connection while an agent is connected; `search_catalog` / `get_product` are available server-side immediately, but the agent won't see them until it reconnects. In reverse, a disabled connection's tools linger in the client's list and fail on call.

The issue offers three options and picks **option 1 — document it in the UI**. Options 2 (sessionful transport) and 3 (polling hint — not actually available in the protocol) are explicitly out of scope; option 2 would reverse part of ADR-033 and must start with an ADR amendment, not code.

### Acceptance criteria (from the issue)

- [ ] The MCP tokens settings page notes that connection changes require a client reconnect to appear.
- [ ] No behaviour change to the transport or the tool registry.

### Explicit non-goals

- No sessions, no `WebStandardStreamableHTTPServerTransport`, no `sendToolListChanged()`.
- No change to `McpToolRegistryService`, `mcp-server.factory.ts`, or any transport file.
- No ADR-033 amendment (that belongs with option 2, if it is ever taken).
- No backend change of any kind — this is copy.

## 2. Research

| Fact | Evidence |
|---|---|
| The limitation is already documented for engineers | `tool-registry.service.interface.ts:19`, `mcp-server.factory.ts:15`, ADR-033 § Phase 1 amendments |
| …but nowhere for the operator | no occurrence of "reconnect" in `apps/web/src/features/mcp-tokens/**` |
| Page is admin-gated and thin | `mcp-tokens-page.tsx` — role check + `PageLayout` + `<McpTokensPanel />` |
| Panel already composes two `article.panel--dense` sections | `mcp-tokens-panel.tsx` — "Create" and "Existing" |
| Panel has an existing test covering all four async states | `mcp-tokens-panel.test.tsx` |
| A CSS block for the panel already exists | `apps/web/src/index.css:16791` `.mcp-tokens-panel` |

## 3. Design

**Placement: an `<Alert tone="info">` at the top of `McpTokensPanel`.**

- **Reuse the primitive, don't hand-roll CSS.** `frontend-ui-style-guide.md` § CSS Implementation Standard: *"add or extend shared primitives before introducing page-specific one-off styling."* `Alert` is the primitive for tonal explanatory copy, and `McpTokensPanel` **already imports it** (used for `createMutation.isError`), so this costs no new import, no new CSS class, and no exposure to the `check-design-tokens` drift checker.
  - An earlier draft of this plan rejected `Alert` on the grounds that the style guide "reserves banners for degraded / incident / warning states". That misreads the guide — the line describes the **workspace status-banner slot** in the page-structure diagram, not the `Alert` primitive, which is listed under *Controls* and is already used app-wide for non-incident messaging.
- **Placement inside the panel, not the page** — because that is where the test harness is. `mcp-tokens-panel.test.tsx` exists; there is **no** `mcp-tokens-page.test.tsx`. Putting the note on the page would mean a new test file for one line of static copy.
- **Top of the panel, above "Create".** This is context an operator wants *before* wiring a client, and guidance appended below a token list is how guidance gets missed.
- **The component's stated purpose widens deliberately.** Its header currently reads *"create form + list + one-time reveal"* — tool availability is none of those three, so the header is updated in the same commit rather than letting the file quietly drift from its own description.
- One placement only. The reveal dialog is a tempting second home (the operator is about to configure a client), but duplicated guidance drifts.

**Copy** — two sentences, stating the cause and the action:

1. Which tools a client sees depends on which connections are enabled and what they support.
2. Clients cache the tool list — after enabling or disabling a connection, reconnect the client for the change to appear.

The first sentence matters as much as the second: without it, "reconnect" reads as a bug workaround rather than a consequence of capability-gated tool registration.

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `apps/web/src/features/mcp-tokens/components/mcp-tokens-panel.tsx` | Add `<Alert tone="info">` at the top of the panel with the two-sentence copy | Renders above "Create"; no new import, no new CSS, no state |
| 2 | Module header on the same file | Widen the stated purpose to include the tool-availability note; cite #1932 | Header matches what the file actually composes |
| 3 | `apps/web/src/features/mcp-tokens/components/mcp-tokens-panel.test.tsx` | Add a case asserting the reconnect guidance renders | `pnpm --filter @openlinker/web test` green |
| 4 | `docs/architecture-overview.md` § MCP | One clause noting the operator-facing mitigation exists on the MCP tokens page | The engineer-facing limitation and its operator-facing mitigation are documented together |

**No CSS step.** Using the existing primitive means `index.css` is untouched, so `check-design-tokens` has nothing new to verify.

## 5. Validation

- **Architecture**: FE-only; `features` → `shared` only; no new dependency direction. No `app`/`pages` import added.
- **Naming**: existing kebab-case files; no new files, so no naming surface.
- **State**: no new state — static copy. No query, no mutation, so the four-state async rule doesn't apply to this section.
- **A11y**: plain semantic markup (`<p>`); no color-only signal; not an `Alert`, so no `role="status"` noise on a healthy page.
- **Security**: none — no token data touched, nothing rendered from user input.
- **Testing**: one component test. No int-spec: nothing crosses HTTP.

## Pre-implement gate

**Skipped deliberately.** The gate exists to catch reuse collisions and contract-surface breaks. This change adds no port, service, DI token, ORM entity, capability, DTO, or barrel export, and touches one component plus its test and a scoped CSS block. There is no contract surface to break.

## Known limitation this does *not* fix

The operator who enables a connection is on `/connections`, not `/settings/mcp-tokens`, so the note is discoverable only if they go looking. Placing a second copy near the connection-enable affordance would widen the blast radius beyond the issue's AC; recorded here as a candidate follow-up rather than silently absorbed.
