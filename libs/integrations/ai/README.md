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
| `anthropic` | `@ai-sdk/anthropic` | Claude (configured via `OL_AI_MODEL` or DB setting) |
| `openai` | `@ai-sdk/openai` | GPT-4o (configured via `OL_AI_MODEL` or DB setting) |

Provider API keys are stored in the encrypted `integration_credentials` table under
`ref = ai-provider:{provider}`. Switch the active provider via `PUT /ai-provider-settings/active`.

## Testing

`FakeAiCompletionAdapter` is exported for unit tests — returns configurable canned
responses without hitting any external API:

```typescript
import { FakeAiCompletionAdapter } from '@openlinker/integrations-ai';
```

## Documentation

- [`docs/architecture-overview.md#13-ai`](../../../docs/architecture-overview.md) — AI bounded context
- [`docs/capabilities.md`](../../../docs/capabilities.md) — capability catalog
