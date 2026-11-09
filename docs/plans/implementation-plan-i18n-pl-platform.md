# Implementation Plan: Polish translation, batch C - platform (#3888)

## 1. Task understanding

A Polish value for every key of batch C's namespaces (extraction issues #3877-#3882), so connections, sales
documents, analytics, settings, AI and token screens read in Polish. Data only: `locales/pl/<namespace>.json`
+ `pl/index.check.ts`. Same rules as #3886 / #3887 (glossary, four plural forms, budgets, no em dash,
gender-neutral first person). Base: `3887-i18n-pl-operations` (contains every extraction).

| Namespace | Strings | From |
|---|---|---|
| `connections`, `adapters`, `allegro-core` | 1,078 / 14 / 92 | #3877, #3878 |
| `invoicing`, `fiscalization`, `sales-documents` | 307 / 23 / 419 | #3879 |
| `analytics` | 635 | #3880 |
| `settings`, `mappings`, `sync-jobs`, `webhook-deliveries`, `cursors`, `dev-ui`, `buyer-emails` | 277 / 170 / 201 / 54 / 20 / 4 / 80 | #3881 |
| `ai-provider-settings`, `mailer-settings`, `mcp-tokens`, `posthog-settings`, `prompt-templates` | 74 / 52 / 71 / 75 / 160 | #3882 |

About 3,800 strings.

## 2. Notes

- Tax and document terms already Polish stay Polish (faktura, paragon, korekta, NIP, KSeF, UPO); terms chosen
  in batches A and B are reused (master = główny, routing = kierowanie; sales-document routing = "wybór
  dokumentu" in batch A, so the page name follows it).
- Prompt template bodies are data, not UI - not in these files.

## 3. Steps (2 agents, no tsc / tests)

1. Agent A: `connections`, `adapters`, `allegro-core`, `analytics`, `settings`, `cursors`, `dev-ui` (~2,120).
2. Agent B: `invoicing`, `fiscalization`, `sales-documents`, `buyer-emails`, `mappings`, `sync-jobs`,
   `webhook-deliveries`, `ai-provider-settings`, `mailer-settings`, `mcp-tokens`, `posthog-settings`,
   `prompt-templates` (~1,690).
3. Me: one term pass across A/B/C, `pl/index.check.ts`, sort, coverage, `check-locales`,
   `check:invariants`, `tsc -b`, local commit.

## 4. Still needed after this

A Polish speaker's on-screen review in `pl` and the overflow pass.
