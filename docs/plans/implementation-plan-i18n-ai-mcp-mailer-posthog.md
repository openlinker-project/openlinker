# Implementation Plan: i18n extraction 15/18 - AI, MCP tokens, mailer and PostHog settings (#3882)

## 1. Task understanding

Move every operator-visible English string in `features/prompt-templates`, `features/mcp-tokens`,
`features/ai-provider-settings`, `features/posthog-settings`, `features/mailer-settings` and their pages
into the namespaces of the same names (`locales/en/<namespace>.json`, ADR-081 as amended), fold in
`features/mcp-tokens/lib/tool-staleness-copy.ts`, and switch the no-literal-text lint on. English only.
Base: `3881-i18n-settings-mappings` @ ccc30d5b4.

## 2. Findings

- ~6,300 lines; one copy module (`tool-staleness-copy.ts`), used only inside mcp-tokens.
- `scripts/check-render-template-fixture-drift.mjs` compares `features/prompt-templates/lib/render-template.ts`
  fixtures with core: its messages stay as they are (an algorithm port, not operator copy).
- Prompt template bodies are data, not UI; example placeholders (`sk-...`, `smtp.example.com`) stay.
- `ai-provider-table.tsx` has its own `formatRelative` -> `useFormat().relativeTime`.

## 3. Steps (2 agents, no tsc, ESLint once each)

1. Agent A: prompt-templates (feature + pages) and ai-provider-settings (feature + page).
2. Agent B: mcp-tokens (feature + page), posthog-settings, mailer-settings.
3. Me: limits, key check, one ESLint, `check:invariants`, local commit.
