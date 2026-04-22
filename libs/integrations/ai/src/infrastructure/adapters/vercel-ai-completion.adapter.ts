/**
 * Vercel AI Completion Adapter (Anthropic)
 *
 * AiCompletionPort implementation backed by Vercel AI SDK Core (`ai`) and the
 * `@ai-sdk/anthropic` provider. Selected by AiIntegrationModule when
 * `OL_AI_PROVIDER=anthropic` (the default).
 *
 * Anthropic prompt-cache note: when `cacheSystemPrompt` is true (default), this
 * adapter attaches `providerOptions.anthropic.cacheControl = { type: 'ephemeral' }`
 * to the system message. The Anthropic API silently no-ops cache_control when
 * the cached prefix is below ~1024 input tokens, so `cachedInputTokens === 0`
 * on a short system prompt is **expected behaviour**, not a bug. Repeat calls
 * with a sufficiently long, stable system prompt should observe
 * `cachedInputTokens > 0` after the first warm-up.
 *
 * Provider error mapping happens at this boundary — no `ai` / `@ai-sdk/*`
 * types leak into the application layer. Rate-limits map to AiRateLimitError,
 * timeouts to AiTimeoutError, parse failures to AiInvalidResponseError, and
 * everything else to AiCompletionError.
 *
 * @module libs/integrations/ai/infrastructure/adapters
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { Logger } from '@openlinker/shared/logging';
import type { AiCompletionPort } from '@openlinker/core/ai/domain/ports/ai-completion.port';
import type {
  AiCompletionInput,
  AiCompletionResult,
} from '@openlinker/core/ai/domain/types/ai-completion.types';
import { AiCompletionError } from '@openlinker/core/ai/domain/exceptions/ai-completion.exception';
import { AiInvalidResponseError } from '@openlinker/core/ai/domain/exceptions/ai-invalid-response.exception';
import { AiRateLimitError } from '@openlinker/core/ai/domain/exceptions/ai-rate-limit.exception';
import { AiTimeoutError } from '@openlinker/core/ai/domain/exceptions/ai-timeout.exception';

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEMPERATURE = 0.2;

/**
 * Optional override hook for tests — allows specs to substitute a stub for
 * the `generateText` function without mocking the entire `ai` module. When
 * not provided, the adapter calls the real SDK function.
 */
export const VERCEL_GENERATE_TEXT_FN_TOKEN = Symbol('VercelGenerateTextFn');
export type VercelGenerateTextFn = typeof generateText;

@Injectable()
export class VercelAiCompletionAdapter implements AiCompletionPort {
  private readonly logger = new Logger(VercelAiCompletionAdapter.name);
  private readonly defaultModel: string;
  private readonly defaultMaxOutputTokens: number;
  private readonly defaultTimeoutMs: number;
  private readonly logPrompt: boolean;
  private readonly generateTextFn: VercelGenerateTextFn;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(VERCEL_GENERATE_TEXT_FN_TOKEN)
    generateTextOverride?: VercelGenerateTextFn,
  ) {
    this.defaultModel = this.configService.get<string>('OL_AI_DEFAULT_MODEL', DEFAULT_MODEL);
    this.defaultMaxOutputTokens = Number(
      this.configService.get<string | number>(
        'OL_AI_DEFAULT_MAX_TOKENS',
        DEFAULT_MAX_OUTPUT_TOKENS,
      ),
    );
    this.defaultTimeoutMs = Number(
      this.configService.get<string | number>('OL_AI_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    );
    this.logPrompt =
      String(this.configService.get<string>('OL_AI_LOG_PROMPT', 'false')).toLowerCase() === 'true';
    this.generateTextFn = generateTextOverride ?? generateText;
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const model = input.model ?? this.defaultModel;
    const maxOutputTokens = input.maxOutputTokens ?? this.defaultMaxOutputTokens;
    const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
    const cacheSystemPrompt = input.cacheSystemPrompt ?? true;
    const requestId = input.requestId;
    const startedAt = Date.now();

    const systemMessage = cacheSystemPrompt
      ? ({
          role: 'system' as const,
          content: input.systemPrompt,
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral' as const } },
          },
        })
      : input.systemPrompt;

    if (this.logPrompt) {
      this.logger.debug(
        `[ai] prompt requestId=${requestId ?? '-'} system=${input.systemPrompt} user=${input.userPrompt}`,
      );
    }

    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await this.generateTextFn({
        model: anthropic(model),
        system: systemMessage,
        prompt: input.userPrompt,
        maxOutputTokens,
        temperature,
        timeout: this.defaultTimeoutMs,
        maxRetries: 0,
      });
    } catch (error: unknown) {
      throw this.mapProviderError(error, requestId);
    }

    if (typeof result.text !== 'string' || result.text.length === 0) {
      throw new AiInvalidResponseError(
        `AI provider returned an empty or non-string response (requestId=${requestId ?? '-'})`,
      );
    }

    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    const cachedInputTokens =
      result.usage.inputTokenDetails?.cacheReadTokens ?? result.usage.cachedInputTokens ?? 0;
    const latencyMs = Date.now() - startedAt;

    this.logger.log(
      `[ai] completion requestId=${requestId ?? '-'} model=${model} latencyMs=${latencyMs} ` +
        `inputTokens=${inputTokens} outputTokens=${outputTokens} cachedInputTokens=${cachedInputTokens}`,
    );

    if (this.logPrompt) {
      this.logger.debug(`[ai] response requestId=${requestId ?? '-'} text=${result.text}`);
    }

    return {
      text: result.text,
      usage: { inputTokens, outputTokens, cachedInputTokens },
      modelUsed: model,
      latencyMs,
    };
  }

  /**
   * Maps any thrown value from the SDK / provider into the closest domain
   * exception. Duck-typed so we never import provider error classes here —
   * those would re-introduce the coupling the port exists to prevent.
   */
  private mapProviderError(error: unknown, requestId: string | undefined): AiCompletionError {
    const ctx = `requestId=${requestId ?? '-'}`;

    if (this.isAbortLikeError(error)) {
      return new AiTimeoutError(`AI completion timed out (${ctx})`, { cause: error });
    }

    if (this.isRateLimitError(error)) {
      return new AiRateLimitError(`AI provider rate limited (${ctx})`, { cause: error });
    }

    const message = this.extractMessage(error);
    return new AiCompletionError(`AI completion failed (${ctx}): ${message}`, { cause: error });
  }

  private isAbortLikeError(error: unknown): boolean {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
      const m = error.message.toLowerCase();
      if (m.includes('abort') || m.includes('timeout') || m.includes('timed out')) return true;
    }
    return false;
  }

  private isRateLimitError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const candidate = error as { statusCode?: unknown; status?: unknown; message?: unknown };
      if (candidate.statusCode === 429 || candidate.status === 429) return true;
      if (typeof candidate.message === 'string') {
        const m = candidate.message.toLowerCase();
        if (m.includes('rate limit') || m.includes('429')) return true;
      }
    }
    return false;
  }

  private extractMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'unknown provider error';
  }
}
