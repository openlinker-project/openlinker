# @openlinker/integrations-ai

Multi-provider LLM adapter for OpenLinker — AI-generated content (offer descriptions,
product copy) via the Vercel AI SDK.

## What this package does

Registers one `VercelAiCompletionAdapter` per supported provider (Anthropic, OpenAI)
plus a `FakeAiCompletionAdapter` for tests and offline development. The
`MultiProviderAiCompletionAdapter` router reads the active provider from the database
on every call and delegates to the matching per-provider adapter.

This package does **not** follow the per-connection plugin pattern — it is a
**stateless port-router** with no `adapterKey` / connection entity. It is registered
as a NestJS dynamic module (`AiIntegrationModule.register()`) in both `apps/api` and
`apps/worker`.

## Capabilities

Provides `AI_COMPLETION_PORT_TOKEN` → `AiCompletionPort`:

```typescript
interface AiCompletionPort {
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
}
```

## Supported providers

| Provider | SDK package | Model |
|---|---|---|
| `anthropic` | `@ai-sdk/anthropic` | Configured via the `OL_AI_DEFAULT_MODEL` env var (default `claude-opus-4-7`) |
| `openai` | `@ai-sdk/openai` | Configured via the `OL_AI_OPENAI_MODEL` env var (default `gpt-4o-mini`) |

The model is env-only - there is no database setting for it; the only DB-persisted
setting is the **active provider**. Provider API keys are stored in the encrypted
`integration_credentials` table under `ref = ai-provider:{provider}`. Switch the
active provider via `PUT /ai-provider-settings/active`.

## Testing

`FakeAiCompletionAdapter` is exported for unit tests — returns configurable canned
responses without hitting any external API:

```typescript
import { FakeAiCompletionAdapter } from '@openlinker/integrations-ai';
```

## Documentation

- [`docs/architecture-overview.md#13-ai`](../../../docs/architecture-overview.md) — AI bounded context
- [`docs/capabilities.md`](../../../docs/capabilities.md) — capability catalog
