/**
 * AI Integration Package — Public Surface
 *
 * Exports the dynamic NestJS module + concrete adapters. Consumers should
 * inject AI_COMPLETION_PORT_TOKEN (re-exported via @openlinker/core/ai)
 * rather than depending on the concrete adapter classes.
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
