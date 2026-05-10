/**
 * Fake AI Completion Adapter
 *
 * Deterministic, network-free AiCompletionPort implementation. Selected by
 * AiIntegrationModule when `OL_AI_PROVIDER=fake`. Used by integration tests
 * and offline local dev so the rest of the stack can exercise the port without
 * an Anthropic API key.
 *
 * The output text is derived from the userPrompt prefix so assertions can pin
 * the exact response. Token counts are length/4 estimates — not literally
 * tokenised, but stable enough for tests that check usage propagation.
 *
 * @module libs/integrations/ai/infrastructure/adapters
 */
import { Injectable } from '@nestjs/common';
import type {
  AiCompletionInput,
  AiCompletionPort,
  AiCompletionResult,
} from '@openlinker/core/ai';

const FAKE_MODEL = 'fake-model';
const FAKE_PREFIX = 'fake:';
const FAKE_USER_PROMPT_SLICE = 120;
const FAKE_LATENCY_MS = 1;

@Injectable()
export class FakeAiCompletionAdapter implements AiCompletionPort {
  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const text = `${FAKE_PREFIX} ${input.userPrompt.slice(0, FAKE_USER_PROMPT_SLICE)}`;
    const inputTokens = Math.ceil(input.systemPrompt.length / 4);
    const outputTokens = Math.ceil(text.length / 4);

    return Promise.resolve({
      text,
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens: 0,
      },
      modelUsed: input.model ?? FAKE_MODEL,
      latencyMs: FAKE_LATENCY_MS,
    });
  }
}
