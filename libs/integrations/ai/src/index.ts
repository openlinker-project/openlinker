/**
 * AI Integration Package — Public Surface
 *
 * Exports the dynamic NestJS module + concrete adapters. Consumers should
 * inject AI_COMPLETION_PORT_TOKEN (re-exported via @openlinker/core/ai)
 * rather than depending on the concrete adapter classes — the runtime
 * binding is the multi-provider router, not any one concrete adapter.
 *
 * @module libs/integrations/ai
 */
export { AiIntegrationModule } from './ai-integration.module';
export { FakeAiCompletionAdapter } from './infrastructure/adapters/fake-ai-completion.adapter';
export {
  VercelAiCompletionAdapter,
  VERCEL_GENERATE_TEXT_FN_TOKEN,
  type VercelGenerateTextFn,
} from './infrastructure/adapters/vercel-ai-completion.adapter';
export {
  MultiProviderAiCompletionAdapter,
  ANTHROPIC_AI_COMPLETION_ADAPTER_TOKEN,
  OPENAI_AI_COMPLETION_ADAPTER_TOKEN,
  FAKE_AI_COMPLETION_ADAPTER_TOKEN,
} from './infrastructure/adapters/multi-provider-ai-completion.adapter';
