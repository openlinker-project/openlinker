/**
 * Vercel AI Completion Adapter — Unit Tests
 *
 * The adapter is now provider-parameterised — one instance per supported
 * provider, locked to that provider at construction. Tests cover both the
 * `anthropic` and `openai` branches, plus the provider-specific cache-control
 * gating: anthropic gets the `providerOptions.anthropic.cacheControl` block,
 * openai never does (would otherwise emit a stray field).
 *
 * Mocks the Vercel AI SDK's `generateText` via the optional override token.
 *
 * @module libs/integrations/ai/infrastructure/adapters
 */
import type { ConfigService } from '@nestjs/config';
import {
  VercelAiCompletionAdapter,
  type VercelGenerateTextFn,
} from './vercel-ai-completion.adapter';
import {
  AiCompletionError,
  AiInvalidResponseError,
  AiProviderKeyMissingError,
  AiRateLimitError,
  AiTimeoutError,
} from '@openlinker/core/ai';
import type { AiProviderCredentialsPort } from '@openlinker/core/ai';

const buildCredentialsPort = (apiKey = 'test-api-key'): jest.Mocked<AiProviderCredentialsPort> => ({
  getApiKey: jest.fn().mockResolvedValue(apiKey),
  describe: jest.fn(),
  describeAll: jest.fn(),
  invalidate: jest.fn(),
});

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
  }> = {}
): Awaited<ReturnType<VercelGenerateTextFn>> =>
  ({
    text: overrides.text ?? 'generated text',
    usage: {
      inputTokens: overrides.inputTokens ?? 100,
      outputTokens: overrides.outputTokens ?? 50,
      inputTokenDetails: {
        cacheReadTokens: overrides.cacheReadTokens,
        noCacheTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      totalTokens: undefined,
      cachedInputTokens: overrides.cachedInputTokensDeprecated,
    },
  }) as unknown as Awaited<ReturnType<VercelGenerateTextFn>>;

const buildAnthropicAdapter = (
  generateTextFn: jest.Mock,
  config: ConfigService = buildConfigService(),
  credentials: jest.Mocked<AiProviderCredentialsPort> = buildCredentialsPort()
): VercelAiCompletionAdapter =>
  new VercelAiCompletionAdapter(
    'anthropic',
    config,
    credentials,
    generateTextFn as unknown as VercelGenerateTextFn
  );

const buildOpenAiAdapter = (
  generateTextFn: jest.Mock,
  config: ConfigService = buildConfigService(),
  credentials: jest.Mocked<AiProviderCredentialsPort> = buildCredentialsPort()
): VercelAiCompletionAdapter =>
  new VercelAiCompletionAdapter(
    'openai',
    config,
    credentials,
    generateTextFn as unknown as VercelGenerateTextFn
  );

describe('VercelAiCompletionAdapter', () => {
  describe('anthropic branch', () => {
    it('forwards system, prompt, and Anthropic cache-control when cacheSystemPrompt is true (default)', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildAnthropicAdapter(generateTextFn);

      await adapter.complete({
        systemPrompt: 'system instructions',
        userPrompt: 'user input',
        requestId: 'req-1',
      });

      expect(generateTextFn).toHaveBeenCalledTimes(1);
      const args = captureFirstCallArgs(generateTextFn);
      expect(args.prompt).toBe('user input');
      expect(args.maxOutputTokens).toBe(2048);
      expect(args.timeout).toBe(60000);
      expect(args.maxRetries).toBe(0);
      expect(args.system).toEqual({
        role: 'system',
        content: 'system instructions',
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
      });
    });

    it('passes the system prompt as a plain string when cacheSystemPrompt is false', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildAnthropicAdapter(generateTextFn);

      await adapter.complete({ systemPrompt: 'sys', userPrompt: 'usr', cacheSystemPrompt: false });

      expect(captureFirstCallArgs(generateTextFn).system).toBe('sys');
    });

    it('uses OL_AI_DEFAULT_MODEL for the anthropic default', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildAnthropicAdapter(
        generateTextFn,
        buildConfigService({ OL_AI_DEFAULT_MODEL: 'claude-haiku-4-5' })
      );

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.modelUsed).toBe('claude-haiku-4-5');
    });

    it('resolves the API key through credentials.getApiKey("anthropic") on every call', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const credentials = buildCredentialsPort('resolved-key-abc');
      const adapter = buildAnthropicAdapter(generateTextFn, buildConfigService(), credentials);

      await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });
      await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(credentials.getApiKey).toHaveBeenCalledTimes(2);
      expect(credentials.getApiKey).toHaveBeenCalledWith('anthropic');
    });
  });

  describe('openai branch', () => {
    it('passes the system prompt as a plain string with NO providerOptions block (no Anthropic cache-control)', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildOpenAiAdapter(generateTextFn);

      await adapter.complete({
        systemPrompt: 'system instructions',
        userPrompt: 'user input',
        // cacheSystemPrompt defaults to true on the input — must still be no-op for openai
      });

      const args = captureFirstCallArgs(generateTextFn);
      expect(args.system).toBe('system instructions');
    });

    it('uses OL_AI_OPENAI_MODEL for the openai default', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildOpenAiAdapter(
        generateTextFn,
        buildConfigService({ OL_AI_OPENAI_MODEL: 'gpt-5-nano' })
      );

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.modelUsed).toBe('gpt-5-nano');
    });

    it('resolves the API key through credentials.getApiKey("openai") on every call', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const credentials = buildCredentialsPort('resolved-openai-key');
      const adapter = buildOpenAiAdapter(generateTextFn, buildConfigService(), credentials);

      await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(credentials.getApiKey).toHaveBeenCalledWith('openai');
    });
  });

  describe('shared behaviour (asserted on the anthropic branch)', () => {
    it('honours per-call model and maxOutputTokens overrides', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildAnthropicAdapter(generateTextFn);

      await adapter.complete({
        systemPrompt: 's',
        userPrompt: 'u',
        model: 'claude-haiku-4-5-20251001',
        maxOutputTokens: 256,
      });

      expect(captureFirstCallArgs(generateTextFn).maxOutputTokens).toBe(256);
    });

    it('reports the requested model in modelUsed', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildAnthropicAdapter(generateTextFn);

      const result = await adapter.complete({
        systemPrompt: 's',
        userPrompt: 'u',
        model: 'custom-model-id',
      });

      expect(result.modelUsed).toBe('custom-model-id');
    });

    it('prefers usage.inputTokenDetails.cacheReadTokens over deprecated usage.cachedInputTokens', async () => {
      const generateTextFn = jest
        .fn()
        .mockResolvedValue(
          buildSuccessResult({ cacheReadTokens: 42, cachedInputTokensDeprecated: 7 })
        );
      const adapter = buildAnthropicAdapter(generateTextFn);

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.usage.cachedInputTokens).toBe(42);
    });

    it('falls back to deprecated usage.cachedInputTokens when cacheReadTokens is missing', async () => {
      const generateTextFn = jest
        .fn()
        .mockResolvedValue(buildSuccessResult({ cachedInputTokensDeprecated: 11 }));
      const adapter = buildAnthropicAdapter(generateTextFn);

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.usage.cachedInputTokens).toBe(11);
    });

    it('defaults cachedInputTokens to 0 when both signals are absent', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildAnthropicAdapter(generateTextFn);

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.usage.cachedInputTokens).toBe(0);
    });

    it('maps abort/timeout-shaped errors to AiTimeoutError', async () => {
      const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
      const generateTextFn = jest.fn().mockRejectedValue(abortError);
      const adapter = buildAnthropicAdapter(generateTextFn);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiTimeoutError
      );
    });

    it('maps a 429 statusCode to AiRateLimitError', async () => {
      const rateLimitError = Object.assign(new Error('rate limited'), { statusCode: 429 });
      const generateTextFn = jest.fn().mockRejectedValue(rateLimitError);
      const adapter = buildAnthropicAdapter(generateTextFn);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiRateLimitError
      );
    });

    it('maps an unknown failure to AiCompletionError', async () => {
      const generateTextFn = jest.fn().mockRejectedValue(new Error('boom'));
      const adapter = buildAnthropicAdapter(generateTextFn);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiCompletionError
      );
    });

    it('throws AiInvalidResponseError when the provider returns empty text', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult({ text: '' }));
      const adapter = buildAnthropicAdapter(generateTextFn);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiInvalidResponseError
      );
    });

    it('reports a non-negative latency', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildAnthropicAdapter(generateTextFn);

      const result = await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('respects env-driven defaults for max tokens and timeout', async () => {
      const generateTextFn = jest.fn().mockResolvedValue(buildSuccessResult());
      const adapter = buildAnthropicAdapter(
        generateTextFn,
        buildConfigService({ OL_AI_DEFAULT_MAX_TOKENS: '512', OL_AI_TIMEOUT_MS: '15000' })
      );

      await adapter.complete({ systemPrompt: 's', userPrompt: 'u' });

      const args = captureFirstCallArgs(generateTextFn);
      expect(args.maxOutputTokens).toBe(512);
      expect(args.timeout).toBe(15000);
    });

    it('propagates AiProviderKeyMissingError unchanged so callers can distinguish "no key" from generic completion failures', async () => {
      const generateTextFn = jest.fn();
      const credentials = buildCredentialsPort();
      credentials.getApiKey.mockRejectedValueOnce(
        new AiProviderKeyMissingError('No API key configured for AI provider')
      );
      const adapter = buildAnthropicAdapter(generateTextFn, buildConfigService(), credentials);

      await expect(adapter.complete({ systemPrompt: 's', userPrompt: 'u' })).rejects.toBeInstanceOf(
        AiProviderKeyMissingError
      );
      expect(generateTextFn).not.toHaveBeenCalled();
    });
  });
});
