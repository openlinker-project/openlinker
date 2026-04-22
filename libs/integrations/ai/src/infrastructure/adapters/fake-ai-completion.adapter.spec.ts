/**
 * Fake AI Completion Adapter — Unit Tests
 *
 * Asserts deterministic output shape: prefix marker, prompt-derived text,
 * length-based token estimates, and propagated model override.
 *
 * @module libs/integrations/ai/infrastructure/adapters
 */
import { FakeAiCompletionAdapter } from './fake-ai-completion.adapter';

describe('FakeAiCompletionAdapter', () => {
  let adapter: FakeAiCompletionAdapter;

  beforeEach(() => {
    adapter = new FakeAiCompletionAdapter();
  });

  describe('complete', () => {
    it('should return text prefixed with "fake:" and derived from the user prompt', async () => {
      const result = await adapter.complete({
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Generate a short product description for a leather wallet.',
      });

      expect(result.text).toBe(
        'fake: Generate a short product description for a leather wallet.',
      );
    });

    it('should truncate the user prompt slice at 120 characters', async () => {
      const longPrompt = 'a'.repeat(200);

      const result = await adapter.complete({
        systemPrompt: 'system',
        userPrompt: longPrompt,
      });

      expect(result.text).toBe(`fake: ${'a'.repeat(120)}`);
    });

    it('should report length-based token estimates and zero cached tokens', async () => {
      const result = await adapter.complete({
        systemPrompt: '12345678', // 8 chars → ceil(8/4) = 2 tokens
        userPrompt: 'hello',
      });

      expect(result.usage.inputTokens).toBe(2);
      expect(result.usage.cachedInputTokens).toBe(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
    });

    it('should propagate the requested model when provided', async () => {
      const result = await adapter.complete({
        systemPrompt: 'sys',
        userPrompt: 'user',
        model: 'claude-haiku-4-5-20251001',
      });

      expect(result.modelUsed).toBe('claude-haiku-4-5-20251001');
    });

    it('should default modelUsed to "fake-model" when no override is given', async () => {
      const result = await adapter.complete({
        systemPrompt: 'sys',
        userPrompt: 'user',
      });

      expect(result.modelUsed).toBe('fake-model');
    });

    it('should report a non-zero latency', async () => {
      const result = await adapter.complete({
        systemPrompt: 'sys',
        userPrompt: 'user',
      });

      expect(result.latencyMs).toBeGreaterThan(0);
    });
  });
});
