/**
 * Vercel AI Completion Adapter — Unit Tests
 *
 * Mocks the Vercel AI SDK's `generateText` via the optional override token.
 * Asserts: argument forwarding (model, prompts, max tokens, cache control),
 * usage propagation (cacheReadTokens preference, deprecated fallback), and
 * error mapping to domain exceptions.
 *
 * @module libs/integrations/ai/infrastructure/adapters
 */
import { ConfigService } from '@nestjs/config';
import {
  VercelAiCompletionAdapter,
  type VercelGenerateTextFn,
} from './vercel-ai-completion.adapter';
import { AiRateLimitError } from '@openlinker/core/ai/domain/exceptions/ai-rate-limit.exception';
import { AiTimeoutError } from '@openlinker/core/ai/domain/exceptions/ai-timeout.exception';
import { AiCompletionError } from '@openlinker/core/ai/domain/exceptions/ai-completion.exception';
import { AiInvalidResponseError } from '@openlinker/core/ai/domain/exceptions/ai-invalid-response.exception';

/**
 * Subset of args we care about asserting in the test. Mirrors the keys passed
 * to `generateText` so we can avoid `any` propagating from `.mock.calls[0][0]`.
 */
interface CapturedGenerateArgs {
  prompt: unknown;
  maxOutputTokens: unknown;
  timeout: unknown;
  maxRetries: unknown;
  system: unknown;
}

const captureFirstCallArgs = (fn: jest.Mock): CapturedGenerateArgs => {
  const calls = fn.mock.calls as unknown as CapturedGenerateArgs[][];
  if (calls.length === 0) {
    throw new Error('generateText was not called');
  }
  return calls[0][0];
};

const buildConfigService = (overrides: Record<string, string | undefined> = {}): ConfigService =>
  ({
    get: <T = string>(key: string, defaultValue?: T): T => {
      const v = overrides[key];
      return (v ?? defaultValue) as T;
    },
  }) as unknown as ConfigService;

const buildSuccessResult = (
  overrides: Partial<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cachedInputTokensDeprecated: number;
  }> = {},
): Awaited<ReturnType<VercelGenerateTextFn>> =>
  ({
    text: overrides.text ?? 'generated text',
    usage: {
      inputTokens: overrides.inputTokens ?? 100,
      outputTokens: overrides.outputTokens ?? 50,
      inputTokenDetails: { cacheReadTokens: overrides.cacheReadTokens, noCacheTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      totalTokens: undefined,
      cachedInputTokens: overrides.cachedInputTokensDeprecated,
    },
  }) as unknown as Awaited<ReturnType<VercelGenerateTextFn>>;

describe('VercelAiCompletionAdapter', () => {
  describe('complete', () => {
    it('should forward model, system, prompt, and cache control to generateText when cacheSystemPrompt is true (default)', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      await adapter.complete({
        systemPrompt: 'system instructions',
        userPrompt: 'user input',
        requestId: 'req-1',
      });

      expect(generateTextFn).toHaveBeenCalledTimes(1);
      const args = captureFirstCallArgs(generateTextFn);
      expect(args.prompt).toBe('user input');
      expect(args.maxOutputTokens).toBe(2048); // default
      expect(args.timeout).toBe(60000); // default
      expect(args.maxRetries).toBe(0);
      expect(args.system).toEqual({
        role: 'system',
        content: 'system instructions',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      });
    });

    it('should pass the system prompt as a plain string when cacheSystemPrompt is false', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      await adapter.complete({
        systemPrompt: 'sys',
        userPrompt: 'usr',
        cacheSystemPrompt: false,
      });

      expect(captureFirstCallArgs(generateTextFn).system).toBe('sys');
    });

    it('should honour per-call model and maxOutputTokens overrides', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      await adapter.complete({
        systemPrompt: 's',
        userPrompt: 'u',
        model: 'claude-haiku-4-5-20251001',
        maxOutputTokens: 256,
      });

      const args = captureFirstCallArgs(generateTextFn);
      expect(args.maxOutputTokens).toBe(256);
      // model is wrapped by the anthropic() factory; we can't assert on the wrapped object,
      // but modelUsed in the result reflects what the adapter passed.
    });

    it('should report the requested model in modelUsed', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      const result = await adapter.complete({
        systemPrompt: 's',
        userPrompt: 'u',
        model: 'custom-model-id',
      });

      expect(result.modelUsed).toBe('custom-model-id');
    });

    it('should prefer usage.inputTokenDetails.cacheReadTokens over deprecated usage.cachedInputTokens', async () => {
      const generateTextFn = jest
        .fn()
        .mockResolvedValue(buildSuccessResult({ cacheReadTokens: 42, cachedInputTokensDeprecated: 7 }));
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.usage.cachedInputTokens).toBe(42);
    });

    it('should fall back to deprecated usage.cachedInputTokens when cacheReadTokens is missing', async () => {
      const generateTextFn = jest
        .fn()
        .mockResolvedValue(buildSuccessResult({ cachedInputTokensDeprecated: 11 }));
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.usage.cachedInputTokens).toBe(11);
    });

    it('should default cachedInputTokens to 0 when both signals are absent', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.usage.cachedInputTokens).toBe(0);
    });

    it('should map abort/timeout-shaped errors to AiTimeoutError', async () => {
      const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
      const generateTextFn = jest.fn().mockRejectedValue(abortError);
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiTimeoutError,
      );
    });

    it('should map a 429 statusCode to AiRateLimitError', async () => {
      const rateLimitError = Object.assign(new Error('rate limited'), { statusCode: 429 });
      const generateTextFn = jest.fn().mockRejectedValue(rateLimitError);
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiRateLimitError,
      );
    });

    it('should map an unknown failure to AiCompletionError', async () => {
      const generateTextFn = jest.fn().mockRejectedValue(new Error('boom'));
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiCompletionError,
      );
    });

    it('should throw AiInvalidResponseError when the provider returns empty text', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult({ text: '' }));
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiInvalidResponseError,
      );
    });

    it('should report a non-negative latency', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = new VercelAiCompletionAdapter(buildConfigService(), generateTextFn);

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should respect env-driven defaults for max tokens and timeout', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = new VercelAiCompletionAdapter(
        buildConfigService({ OL_AI_DEFAULT_MAX_TOKENS: '512', OL_AI_TIMEOUT_MS: '15000' }),
        generateTextFn,
      );

      await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      const args = captureFirstCallArgs(generateTextFn);
      expect(args.maxOutputTokens).toBe(512);
      expect(args.timeout).toBe(15000);
    });
  });
});
